// Bun bundles imported images as files and gives back their (hashed) URL.
declare module "*.svg" {
  const url: string;
  export default url;
}
declare module "*.png" {
  const url: string;
  export default url;
}
