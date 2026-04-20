import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="zh-CN">
      <Head>
        {/* 引入 antd 的全局样式 */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/antd@5.12.8/dist/reset.css" />
        {/* 或者，如果你已经将 antd 的 CSS 文件下载到本地，可以这样引入：
        <link rel="stylesheet" href="/antd-reset.css" />
        */}
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}