// Non-interactive wrapper — the app-scripts CLI prompts even when all
// required options are passed. Reads CONTENTFUL_* from .env / environment.
const { upsertAppActions } = require('@contentful/app-scripts/lib/upsert-actions/upsert-actions');

upsertAppActions({
  accessToken: process.env.CONTENTFUL_ACCESS_TOKEN,
  organizationId: process.env.CONTENTFUL_ORG_ID,
  appDefinitionId: process.env.CONTENTFUL_APP_DEF_ID,
  host: 'api.contentful.com',
  manifestFile: 'contentful-app-manifest.json',
})
  .then(() => console.log('App actions upserted'))
  .catch((err) => {
    console.error(err.message, JSON.stringify(err.details || ''));
    process.exit(1);
  });
