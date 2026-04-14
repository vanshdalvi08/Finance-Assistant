declare module "qrcode" {
  export interface QRCodeToDataURLOptions {
    margin?: number;
    width?: number;
    [key: string]: unknown;
  }

  export function toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>;
}
