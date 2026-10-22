import { bindings, defineConfig } from 'cf/config';
export default defineConfig({
  accountId: 'abcc8515822b473a126db67500a990e4',
  worker: {
    name: 'paper3-lcs-rating-api',
    entrypoint: '../worker/index.js',
    compatibilityDate: '2026-10-22',
    env: {
      DB: bindings.d1({id: '4b2e62be-ca93-42dd-ae66-f3cbdbbb22e0'}),
      MEDIA: process.env.LCS_WITH_MEDIA === 'true' ? bindings.r2({name: 'paper3-lcs-private-20261022', jurisdiction: 'eu'}) : undefined,
      AUTH_SECRET: bindings.secret(),
      ADMIN_SECRET: bindings.secret(),
      ALLOWED_ORIGINS: bindings.text('https://deepresearcher.github.io,http://127.0.0.1:5178,http://localhost:5178'),
      STUDY_ID: bindings.text('cattle-lcs-20261022'),
      STUDY_OPEN: bindings.text(process.env.LCS_STUDY_OPEN === 'true' ? 'true' : 'false')
    },
    observability: {enabled: true, redactQueryString: true, logs: {enabled: true, invocationLogs: false}, traces: {enabled: true}}
  }
});
