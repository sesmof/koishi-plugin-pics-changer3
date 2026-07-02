import { Context, Schema } from 'koishi';
export declare const name = "pics-changer3";
export declare const inject: {
    required: string[];
};
export interface Config {
    upsymmetry: string;
    downsymmetry: string;
    leftsymmetry: string;
    rightsymmetry: string;
    defaultsymmetry: string;
    promptTimeout: number;
}
export declare const Config: Schema<Config>;
export declare function apply(ctx: Context, config: Config): void;
