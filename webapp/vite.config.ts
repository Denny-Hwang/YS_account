import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-expect-error — 빌드 스크립트라 타입 선언이 없다.
import { gasSharedModules, sharedDir } from './scripts/gas-shared.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

// GitHub Pages 프로젝트 사이트는 /<repo>/ 아래에 붙는다. 로컬 개발에서는 '/' 로 둔다.
const base = process.env.VITE_BASE ?? '/'

export default defineConfig({
  base,
  plugins: [gasSharedModules(), react()],
  resolve: {
    alias: { '@shared': sharedDir as string },
  },
  server: {
    fs: { allow: [path.resolve(here, '..')] },
  },
  build: { outDir: 'dist', sourcemap: false },
})
