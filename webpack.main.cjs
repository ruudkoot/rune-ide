module.exports = {
  entry: './src/host/main.ts',
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: { loader: 'ts-loader', options: { transpileOnly: true } } }] },
  resolve: { extensions: ['.js', '.ts', '.tsx'] },
};
