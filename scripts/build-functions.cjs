// Non-interactive wrapper — the app-scripts CLI prompts for watch/esbuild
// options even in CI, so call the build API directly.
const { buildFunctions } = require('@contentful/app-scripts/lib/build-functions/build-functions');

buildFunctions({ manifestFile: 'contentful-app-manifest.json', watch: false })
  .then(() => console.log('Functions built'))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
