import { Schema } from 'koishi'

export interface Config {
  enableQuote: boolean
  promptTimeout: number

  upsymmetry: string
  downsymmetry: string
  leftsymmetry: string
  rightsymmetry: string
  defaultsymmetry: string
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    enableQuote: Schema.boolean().default(true).description('bot发送消息时引用触发指令的原始消息'),
    promptTimeout: Schema.number().default(30).description('等待用户发送图片的超时时间 (秒)')
  }).description('基础设置'),
  Schema.object({
    upsymmetry: Schema.string().default('上对称').description('上对称指令'),
    downsymmetry: Schema.string().default('下对称').description('下对称指令'),
    leftsymmetry: Schema.string().default('左对称').description('左对称指令'),
    rightsymmetry: Schema.string().default('右对称').description('右对称指令'),
    defaultsymmetry: Schema.string().default('对称').description('默认帮助指令（仅显示帮助，不处理图片）')
  }).description('指令设置')
])
