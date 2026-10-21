// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// `.arena/` holds the arena skill's run files: tens of thousands of scratch
// copies of this repo, node_modules included. Metro would crawl and watch
// all of it, which is enough to run the dev server out of memory. None of it
// is app code.
config.resolver.blockList = [/[\\/]\.arena[\\/].*/];

module.exports = config;
