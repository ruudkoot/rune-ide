const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
module.exports = {
  optimization: { minimize: false },
  module: { rules: [
    { test: /\.tsx?$/, exclude: /node_modules/, use: { loader: 'ts-loader', options: { transpileOnly: true } } },
    { test: /\.css$/, use: ['style-loader', 'css-loader'] },
    { test: /\.(ttf|woff2?)$/, type: 'asset/resource' },
  ] },
  resolve: { extensions: ['.js', '.ts', '.tsx'] },
  plugins: [new MonacoWebpackPlugin({ languages: [], filename: '[name].worker.js' })],
};
