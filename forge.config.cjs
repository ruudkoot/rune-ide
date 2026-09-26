const path = require('node:path');
module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'rune-ide',
    extraResource: ['service.rbc', 'compiler.rbc', 'compiler-info.json'].map(file => path.join(__dirname, 'build', file)),
  },
  plugins: [{
    name: '@electron-forge/plugin-webpack',
    config: {
      mainConfig: './webpack.main.cjs',
      renderer: {
        config: './webpack.renderer.cjs',
        entryPoints: [{ html: './src/renderer/index.html', js: './src/renderer/app.tsx', name: 'main_window', preload: { js: './src/host/preload.ts' } }],
      },
    },
  }],
};
