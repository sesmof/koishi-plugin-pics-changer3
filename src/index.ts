import * as crypto from 'node:crypto' // 使用 Node.js 原生 crypto 模块
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import type {} from '@koishijs/plugin-help'
import { Context, Session, h } from 'koishi'
import { } from 'koishi-plugin-ffmpeg' // 声明依赖 ffmpeg 服务

import type { Config } from './config'

export { Config } from './config'

export const name = 'pics-changer3'

// 注入所需的 http 和 ffmpeg 服务
export const inject = {
  required: ['http', 'ffmpeg']
}

export function apply(ctx: Context, config: Config) {
  const directions = [
    { name: config.upsymmetry, description: '保留上半边，沿水平中线将上半边上下镜像到下半边，覆盖原下半边。' },
    { name: config.downsymmetry, description: '保留下半边，沿水平中线将下半边上下镜像到上半边，覆盖原上半边。' },
    { name: config.leftsymmetry, description: '保留左半边，沿垂直中线将左半边左右镜像到右半边，覆盖原右半边。' },
    { name: config.rightsymmetry, description: '保留右半边，沿垂直中线将右半边左右镜像到左半边，覆盖原左半边。' },
  ]
  const imageUsage = [
    '支持静态图片和 GIF 动图，可一次附带多张图片。',
    '用法：在指令后附图，或引用含图片的消息后发送指令；引用图片优先。',
    `也可以先发送方向指令，再在 ${config.promptTimeout} 秒内发送图片。`,
    '指令名中的方向表示保留哪一半；这些操作生成对称图，不是将整张图片翻转。',
  ].join('\n')

  const directionCommands = directions.map(({ name, description }) =>
    ctx.command(`${name} [...图片]`, description)
      .usage(`${description}\n\n${imageUsage}`)
      .example(`${name}（附上图片，或引用图片后发送）`)
      .action(async ({ session }, ...图片) => handleSymmetry(session, name, 图片)))

  const helpCommand = ctx.command(config.defaultsymmetry, '查看图片对称指令的详细帮助')
    .usage([
      `发送 ${config.defaultsymmetry} 等同于 ${config.defaultsymmetry} --help，只显示帮助，不处理图片。`,
      '',
      ...directions.map(({ name, description }) => `${name}：${description}`),
      '',
      imageUsage,
      `发送“方向指令 --help”可查看该指令的单独帮助，例如 ${config.leftsymmetry} --help。`,
    ].join('\n'))
    .example(config.defaultsymmetry)
    .example(`${config.leftsymmetry}（附上图片，保留左半边并镜像到右半边）`)
    .action(async ({ session }) => {
      if (!session) return
      if (!ctx.$commander.get('help') || !helpCommand._options.help) {
        return withQuote(session, '请启用 Koishi 的 help 插件及其 options 配置，以查看指令帮助。')
      }
      await session.execute(`${config.defaultsymmetry} --help`)
    })

  // 原生帮助由 help 插件发送，也遵循本插件的引用开关。
  const helpTargets = new Set([...directionCommands, helpCommand])
  ctx.on('help/command', (output, command, session) => {
    if (helpTargets.has(command) && config.enableQuote && session.messageId) {
      output.unshift(h.quote(session.messageId).toString())
    }
  })

  function withQuote(session: Session, content: string | h) {
    return config.enableQuote && session.messageId
      ? [h.quote(session.messageId), content]
      : content
  }

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
      await session.send(withQuote(session, '请发送图片或动图'))
      const promptResult = await session.prompt(config.promptTimeout * 1000)
      if (!promptResult) {
        return withQuote(session, '未收到图片')
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
      return withQuote(session, '请发送有效的图片')
    }

    // 成功获取到图片元素数组后，调用修改函数
    try {
      const results = await changeimg(allImages, commandType)
      for (const result of results) {
        await session.send(withQuote(session, result))
      }
    } catch (error) {
      if (error instanceof Error) {
        return withQuote(session, `处理失败: ${error.message}`)
      }
      return withQuote(session, '处理失败: 发生了未知错误')
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
      const mime = isGif ? 'image/gif' : 'image/png'
      const dataUrl = `data:${mime};base64,${outputBuffer.toString('base64')}`

      outputElements.push(h.image(dataUrl))
    }

    return outputElements
  }

  // 上对称 (wc -> wm)：保留上半部不动，翻转贴到下半部
  async function UPsymmetry(input: Buffer, isGif: boolean): Promise<Buffer> {
    const filter = 'format=rgba,split[main][flip];[flip]crop=iw:ih/2:0:0,vflip[flipped];[main][flipped]overlay=0:H/2'
    return runFFmpegWithFile(input, filter, isGif)
  }

  // 下对称 (wm -> wc)：保留下半部不动，翻转贴到上半部
  async function DOWNsymmetry(input: Buffer, isGif: boolean): Promise<Buffer> {
    const filter = 'format=rgba,split[main][flip];[flip]crop=iw:ih/2:0:ih/2,vflip[flipped];[main][flipped]overlay=0:0'
    return runFFmpegWithFile(input, filter, isGif)
  }

  // 左对称 (ba -> bd)：保留左半部不动，翻转贴到右半部
  async function LEFTsymmetry(input: Buffer, isGif: boolean): Promise<Buffer> {
    const filter = 'format=rgba,split[main][flip];[flip]crop=iw/2:ih:0:0,hflip[flipped];[main][flipped]overlay=W/2:0'
    return runFFmpegWithFile(input, filter, isGif)
  }

  // 右对称 (ab -> db)：保留右半部不动，翻转贴到左半部
  async function RIGHTsymmetry(input: Buffer, isGif: boolean): Promise<Buffer> {
    const filter = 'format=rgba,split[main][flip];[flip]crop=iw/2:ih:iw/2:0,hflip[flipped];[main][flipped]overlay=0:0'
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
        builder.outputOption('-c:v', 'png')
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
