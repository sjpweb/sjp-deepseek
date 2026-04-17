module.exports = {
    presets: ['next/babel'], // Next.js 已经预设好了
    plugins: [
      // 配置 antd 的按需加载
      [
        'import',
        {
          libraryName: 'antd',
          libraryDirectory: 'es', // 使用 antd 的 es 版本，对 tree-shaking 更友好
          style: true, // 自动加载 CSS 文件
        },
      ],
    ],
  };