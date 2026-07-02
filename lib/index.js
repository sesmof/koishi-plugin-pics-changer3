var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  Config: () => Config,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(src_exports);
var import_koishi = require("koishi");
var fs = __toESM(require("node:fs/promises"));
var path = __toESM(require("node:path"));
var os = __toESM(require("node:os"));
var crypto = __toESM(require("node:crypto"));
var name = "pics-changer3";
var inject = {
  required: ["http", "ffmpeg"]
};
var Config = import_koishi.Schema.object({
  upsymmetry: import_koishi.Schema.string().default("上对称").description("上对称指令"),
  downsymmetry: import_koishi.Schema.string().default("下对称").description("下对称指令"),
  leftsymmetry: import_koishi.Schema.string().default("左对称").description("左对称指令"),
  rightsymmetry: import_koishi.Schema.string().default("右对称").description("右对称指令"),
  defaultsymmetry: import_koishi.Schema.string().default("对称").description("默认对称指令"),
  promptTimeout: import_koishi.Schema.number().default(30).description("等待用户发送图片的超时时间 (秒)")
});
function apply(ctx, config) {
  ctx.command(`${config.upsymmetry} [...图片]`).action(async ({ session }, ...图片) => handleSymmetry(session, config.upsymmetry, 图片));
  ctx.command(`${config.downsymmetry} [...图片]`).action(async ({ session }, ...图片) => handleSymmetry(session, config.downsymmetry, 图片));
  ctx.command(`${config.leftsymmetry} [...图片]`).action(async ({ session }, ...图片) => handleSymmetry(session, config.leftsymmetry, 图片));
  ctx.command(`${config.rightsymmetry} [...图片]`).action(async ({ session }, ...图片) => handleSymmetry(session, config.rightsymmetry, 图片));
  ctx.command(`${config.defaultsymmetry} [...图片]`).action(async ({ session }, ...图片) => handleSymmetry(session, config.defaultsymmetry, 图片));
  async function handleSymmetry(session, commandType, inputImages) {
    if (!session) return;
    let currentImages = [...inputImages];
    if (session.quote) {
      const quoteElements = import_koishi.h.parse(session.quote.content ?? "");
      const quoteImages = quoteElements.filter((el) => ["img", "mface", "image"].includes(el.type));
      if (quoteImages.length > 0) {
        currentImages = [session.quote.content ?? ""];
      }
    }
    if (currentImages.length === 0) {
      await session.send("请发送图片或动图");
      const promptResult = await session.prompt(config.promptTimeout * 1e3);
      if (!promptResult) {
        return "未收到图片";
      }
      currentImages = [promptResult];
    }
    const allImages = [];
    for (const 图片Item of currentImages) {
      const elements = import_koishi.h.parse(图片Item);
      const images = elements.filter((el) => ["img", "mface", "image"].includes(el.type));
      allImages.push(...images);
    }
    if (allImages.length === 0) {
      return "请发送有效的图片";
    }
    try {
      const results = await changeimg(allImages, commandType);
      for (const result of results) {
        await session.send(result);
      }
    } catch (error) {
      if (error instanceof Error) {
        return `处理失败: ${error.message}`;
      }
      return `处理失败: 发生了未知错误`;
    }
  }
  __name(handleSymmetry, "handleSymmetry");
  async function changeimg(imgElements, change_option) {
    const outputElements = [];
    for (const img of imgElements) {
      const url = img.attrs.src || img.attrs.url;
      if (!url) continue;
      const file = await ctx.http.file(url);
      if (!file || !file.data) continue;
      const inputBuffer = Buffer.from(file.data);
      let outputBuffer;
      const isGif = file.mime === "image/gif" || url.toLowerCase().endsWith(".gif");
      if (change_option === config.upsymmetry) {
        outputBuffer = await UPsymmetry(inputBuffer, isGif);
      } else if (change_option === config.downsymmetry) {
        outputBuffer = await DOWNsymmetry(inputBuffer, isGif);
      } else if (change_option === config.rightsymmetry) {
        outputBuffer = await RIGHTsymmetry(inputBuffer, isGif);
      } else {
        outputBuffer = await LEFTsymmetry(inputBuffer, isGif);
      }
      if (!outputBuffer || outputBuffer.length === 0) {
        throw new Error("FFmpeg 处理后输出的数据为空");
      }
      const mime = file.mime || (isGif ? "image/gif" : "image/png");
      const dataUrl = `data:${mime};base64,${outputBuffer.toString("base64")}`;
      outputElements.push(import_koishi.h.image(dataUrl));
    }
    return outputElements;
  }
  __name(changeimg, "changeimg");
  async function UPsymmetry(input, isGif) {
    const filter = "split[main][flip];[flip]crop=iw:ih/2:0:0,vflip[flipped];[main][flipped]overlay=0:H/2";
    return runFFmpegWithFile(input, filter, isGif);
  }
  __name(UPsymmetry, "UPsymmetry");
  async function DOWNsymmetry(input, isGif) {
    const filter = "split[main][flip];[flip]crop=iw:ih/2:0:ih/2,vflip[flipped];[main][flipped]overlay=0:0";
    return runFFmpegWithFile(input, filter, isGif);
  }
  __name(DOWNsymmetry, "DOWNsymmetry");
  async function LEFTsymmetry(input, isGif) {
    const filter = "split[main][flip];[flip]crop=iw/2:ih:0:0,hflip[flipped];[main][flipped]overlay=W/2:0";
    return runFFmpegWithFile(input, filter, isGif);
  }
  __name(LEFTsymmetry, "LEFTsymmetry");
  async function RIGHTsymmetry(input, isGif) {
    const filter = "split[main][flip];[flip]crop=iw/2:ih:iw/2:0,hflip[flipped];[main][flipped]overlay=0:0";
    return runFFmpegWithFile(input, filter, isGif);
  }
  __name(RIGHTsymmetry, "RIGHTsymmetry");
  async function runFFmpegWithFile(input, filter, isGif) {
    const uniqueId = crypto.randomUUID();
    const ext = isGif ? ".gif" : ".png";
    const tmpInPath = path.join(os.tmpdir(), `koishi_sym_in_${uniqueId}${ext}`);
    try {
      await fs.writeFile(tmpInPath, input);
      const builder = ctx.ffmpeg.builder();
      builder.input(tmpInPath);
      if (isGif) {
        const gifFilter = `${filter}[v];[v]split[a][b];[b]palettegen=stats_mode=single[p];[a][p]paletteuse`;
        builder.outputOption("-filter_complex", gifFilter);
        builder.outputOption("-f", "gif");
      } else {
        builder.outputOption("-filter_complex", filter);
        builder.outputOption("-vframes", "1");
        builder.outputOption("-f", "image2");
      }
      const resultBuffer = await builder.run("buffer");
      return resultBuffer;
    } finally {
      fs.unlink(tmpInPath).catch(() => {
      });
    }
  }
  __name(runFFmpegWithFile, "runFFmpegWithFile");
}
__name(apply, "apply");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  inject,
  name
});
