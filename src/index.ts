import { Context, Schema, Session, h } from 'koishi'
import { } from 'koishi-plugin-ffmpeg' // 声明依赖 ffmpeg 服务
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto' // 使用 Node.js 原生 crypto 模块

export const name = 'pics-changer3'

// 注入所需的 http 和 ffmpeg 服务
export const inject = {
  required: ['http', 'ffmpeg']
}

export interface Config {
  upsymmetry: string
  downsymmetry: string
  leftsymmetry: string
  rightsymmetry: string
  defaultsymmetry: string
  promptTimeout: number
}

export const Config: Schema<Config> = Schema.object({
  upsymmetry: Schema.string().default('上对称').description('上对称指令'),
  downsymmetry: Schema.string().default('下对称').description('下对称指令'),
  leftsymmetry: Schema.string().default('左对称').description('左对称指令'),
  rightsymmetry: Schema.string().default('右对称').description('右对称指令'),
  defaultsymmetry: Schema.string().default('对称').description('默认对称指令'),
  promptTimeout: Schema.number().default(30).description('等待用户发送图片的超时时间 (秒)')
})

export function apply(ctx: Context, config: Config) {

  // 1. 注册 5 个指令，统一调用核心处理函数 handleSymmetry
  ctx.command(`${config.upsymmetry} [...图片]`).action(async ({ session }, ...图片) => handleSymmetry(session, config.upsymmetry, 图片))
  ctx.command(`${config.downsymmetry} [...图片]`).action(async ({ session }, ...图片) => handleSymmetry(session, config.downsymmetry, 图片))
  ctx.command(`${config.leftsymmetry} [...图片]`).action(async ({ session }, ...图片) => handleSymmetry(session, config.leftsymmetry, 图片))
  ctx.command(`${config.rightsymmetry} [...图片]`).action(async ({ session }, ...图片) => handleSymmetry(session, config.rightsymmetry, 图片))
  ctx.command(`${config.defaultsymmetry} [...图片]`).action(async ({ session }, ...图片) => handleSymmetry(session, config.defaultsymmetry, 图片))

  // 核心业务逻辑处理函数
  async function handleSymmetry(session: Session | undefined, commandType: string, inputImages: string[]) {
    if (!session) return

    let currentImages = [...inputImages]

    // 优先检查引用消息中的图片
    if (session.quote) {
      const quoteElements = h.parse(session.quote.content ?? '')
      const quoteImages = quoteElements.filter(el => ['img', 'mface', 'image'].includes(el.type))

      if (quoteImages.length > 0) {
        currentImages = [session.quote.content ?? '']
      }
    }

    // 如果没有图片参数且没有引用消息中的图片，则交互式获取
    if (currentImages.length === 0) {
      await session.send('请发送图片或动图')
      const promptResult = await session.prompt(config.promptTimeout * 1000)
      if (!promptResult) {
        return '未收到图片'
      }
      currentImages = [promptResult]
    }

    // 解析所有图片参数
    const allImages: h[] = []
    for (const 图片Item of currentImages) {
      const elements = h.parse(图片Item)
      const images = elements.filter(el => ['img', 'mface', 'image'].includes(el.type))
      allImages.push(...images)
    }

    if (allImages.length === 0) {
      return '请发送有效的图片'
    }

    // 成功获取到图片元素数组后，调用修改函数
    try {
      const results = await changeimg(allImages, commandType)
      for (const result of results) {
        await session.send(result)
      }
    } catch (error) {
      if (error instanceof Error) {
        return `处理失败: ${error.message}`
      }
      return `处理失败: 发生了未知错误`
    }
  }

  // 图片修改主分发函数
  async function changeimg(imgElements: h[], change_option: string): Promise<h[]> {
    const outputElements: h[] = []

    for (const img of imgElements) {
      const url = img.attrs.src || img.attrs.url
      if (!url) continue

      const file = await ctx.http.file(url)
      if (!file || !file.data) continue

      const inputBuffer = Buffer.from(file.data)
      let outputBuffer: Buffer
      
      // 判断是否为 GIF 动图
      const isGif = file.mime === 'image/gif' || url.toLowerCase().endsWith('.gif')

      // 根据不同的指令，调用对应的 FFmpeg 滤镜处理函数
      if (change_option === config.upsymmetry) {
        outputBuffer = await UPsymmetry(inputBuffer, isGif)
      } else if (change_option === config.downsymmetry) {
        outputBuffer = await DOWNsymmetry(inputBuffer, isGif)
      } else if (change_option === config.rightsymmetry) {
        outputBuffer = await RIGHTsymmetry(inputBuffer, isGif)
      } else {
        outputBuffer = await LEFTsymmetry(inputBuffer, isGif)
      }

      if (!outputBuffer || outputBuffer.length === 0) {
        throw new Error('FFmpeg 处理后输出的数据为空')
      }

      // 将 Buffer 转换为带 mime 头的标准 Data URL 字符串
      const mime = file.mime || (isGif ? 'image/gif' : 'image/png')
      const dataUrl = `data:${mime};base64,${outputBuffer.toString('base64')}`

      outputElements.push(h.image(dataUrl))
    }

    return outputElements
  }

  // 上对称 (wc -> wm)：保留上半部不动，翻转贴到下半部
  async function UPsymmetry(input: Buffer, isGif: boolean): Promise<Buffer> {
    const filter = 'split[main][flip];[flip]crop=iw:ih/2:0:0,vflip[flipped];[main][flipped]overlay=0:H/2'
    return runFFmpegWithFile(input, filter, isGif)
  }

  // 下对称 (wm -> wc)：保留下半部不动，翻转贴到上半部
  async function DOWNsymmetry(input: Buffer, isGif: boolean): Promise<Buffer> {
    const filter = 'split[main][flip];[flip]crop=iw:ih/2:0:ih/2,vflip[flipped];[main][flipped]overlay=0:0'
    return runFFmpegWithFile(input, filter, isGif)
  }

  // 左对称 (ba -> bd)：保留左半部不动，翻转贴到右半部
  async function LEFTsymmetry(input: Buffer, isGif: boolean): Promise<Buffer> {
    const filter = 'split[main][flip];[flip]crop=iw/2:ih:0:0,hflip[flipped];[main][flipped]overlay=W/2:0'
    return runFFmpegWithFile(input, filter, isGif)
  }

  // 右对称 (ab -> db)：保留右半部不动，翻转贴到左半部
  async function RIGHTsymmetry(input: Buffer, isGif: boolean): Promise<Buffer> {
    const filter = 'split[main][flip];[flip]crop=iw/2:ih:iw/2:0,hflip[flipped];[main][flipped]overlay=0:0'
    return runFFmpegWithFile(input, filter, isGif)
  }

  /**
   * 采用“文件落地输入 + 内存 Buffer 输出”的混合型底层解决方案
   */
  async function runFFmpegWithFile(input: Buffer, filter: string, isGif: boolean): Promise<Buffer> {
    const uniqueId = crypto.randomUUID()
    const ext = isGif ? '.gif' : '.png'
    const tmpInPath = path.join(os.tmpdir(), `koishi_sym_in_${uniqueId}${ext}`)

    try {
      // 1. 将输入数据写入物理临时文件
      await fs.writeFile(tmpInPath, input)

      // 2. 构建 FFmpeg 任务
      const builder = ctx.ffmpeg.builder()
      builder.input(tmpInPath)

      if (isGif) {
        // 使用双路自适应高质量调色盘滤镜链
        const gifFilter = `${filter}[v];[v]split[a][b];[b]palettegen=stats_mode=single[p];[a][p]paletteuse`
        builder.outputOption('-filter_complex', gifFilter)
        builder.outputOption('-f', 'gif')
      } else {
        builder.outputOption('-filter_complex', filter)
        builder.outputOption('-vframes', '1')
        builder.outputOption('-f', 'image2')
      }

      // 3. 运行并返回内存 Buffer
      const resultBuffer = await builder.run('buffer')
      return resultBuffer

    } finally {
      // 4. 清理创建的输入临时文件
      fs.unlink(tmpInPath).catch(() => {})
    }
  }
}


//myver 0.0.1
// import { Context, Schema, Session, h } from 'koishi'
// import { } from 'koishi-plugin-ffmpeg'

// export const name = 'pics-changer'

// export interface Config {
//   upsymmetry: string
//   downsymmetry: string
//   leftsymmetry: string
//   rightsymmetry: string
//   defaultsymmetry: string
//   promptTimeout: number
// }

// export const Config: Schema<Config> = Schema.object({
//   upsymmetry: Schema.string().default('上对称').description('上对称指令'),
//   downsymmetry: Schema.string().default('下对称').description('下对称指令'),
//   leftsymmetry: Schema.string().default('左对称').description('左对称指令'),
//   rightsymmetry: Schema.string().default('右对称').description('右对称指令'),
//   defaultsymmetry: Schema.string().default('对称').description('默认对称指令'),
//   promptTimeout: Schema.number().default(30).description('等待用户发送图片的超时时间 (秒)')
// })

// export function apply(ctx: Context, config: Config) {
  
//   ctx.command(`${config.upsymmetry} [...图片]`)
//     .action(async ({ session },  ...图片)=> {
//       // 优先检查引用消息中的图片
//       if (session.quote) {
//         loginfo('检测到引用消息，尝试从引用消息中提取图片')
//         const quoteElements = h.parse(session.quote.content)
//         const quoteImages = quoteElements.filter(el => ['img', 'mface', 'image', 'video'].includes(el.type))

//         if (quoteImages.length > 0) {
//           loginfo('从引用消息中找到图片:', quoteImages.length, '个')
//           图片 = [session.quote.content]
//         }
//       }

//       // 如果没有图片参数且没有引用消息中的图片，则交互式获取
//       if (图片.length === 0) {
//         await session.send('请发送图片或视频')
//         const promptResult = await session.prompt(config.promptTimeout * 1000)
//         if (!promptResult) {
//           return '未收到图片或视频'
//         }
//         图片 = [promptResult]
//       }

//       // 解析所有图片参数
//       let allImages = []
//       for (const 图片Item of 图片) {
//         const elements = h.parse(图片Item)
//         const images = elements.filter(el => ['img', 'mface', 'image', 'video'].includes(el.type))
//         allImages.push(...images)
//       }

//       if (allImages.length === 0) {
//         return '请发送有效的图片或视频'
//       }

//     })


  

  

//   // ctx.command(`${config.upsymmetry} [图片]`, { captureQuote: false })
//   // .userFields(['id', 'name', 'authority'])
//   // .action(async ({ session }, 图片) => {

//   // }






  
//   //图片修改函数
//   async function changeimg(
//     img: any,
//     change_option: string
//     ){
//       if (change_option === config.upsymmetry) {

//       }
//       if (change_option === config.downsymmetry) {
        
//       }
//       if (change_option === config.leftsymmetry || change_option === config.defaultsymmetry) {

//       }
//       if (change_option === config.rightsymmetry) {

//       }
//     }


//   //图片修改函数的具体实现
//   //上对称
//   function UPsymmetry(
//     img: any
//   ){

//   }

//   //下对称
//   function DOWNsymmetry(
//     img: any
//   ){

//   }

//   //左对称
//   function LEFTsymmetry(
//     img: any
//   ){

//   }

//   //右对称
//   function RIGHTsymmetry(
//     img: any
//   ){

//   }

// }

