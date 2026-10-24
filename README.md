# Shirley Creative Studio Mobile V0.3.1

手机试跑版，基于 V0.3 原始项目。移动端增加底部三标签导航、触摸构图、照片库与控制面板切换、iPhone 安全区域适配。

## 使用
打开 index.html，切到「照片/风格」选择照片，再到「编辑」看预览，或「调色/封面」修改参数。
最好通过 HTTPS 静态网站托管后在 Safari/Chrome 中访问；iPhone 文件 App 直接打开 HTML 可能出现浏览器沙盒和下载限制。
项目 JSON 含原始照片，体积可能很大。多文件批量下载在 iOS 上可能被限制。
尚未接入联网 AI、云同步、自动抠图。HEIC 解码依赖浏览器，建议先用 JPG/PNG 测试。
