// frontend/src/types/aws-amplify.d.ts
declare module "aws-amplify" {
  // 必要なものだけ any で受け流します
  export const Auth: any;
  export const DataStore: any;
  export const Hub: any;
  export const initSchema: any;
}
