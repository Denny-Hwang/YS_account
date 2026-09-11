import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/** Apps Script 순수 모듈이 들어 있는 폴더. */
export const sharedDir = path.resolve(here, '../../apps-script/src')

/**
 * GAS 용 ES5 파일을 ESM 으로 바꾼다.
 * 그 파일들은 GAS 가 전역 스코프에 이어 붙이는 형태라 export 문이 없다.
 * 최상위 function 이름을 모아 export 를 붙이고, Node 전용 module.exports 꼬리는 잘라낸다.
 * @param {string} code
 * @returns {?string} 내보낼 함수가 없으면 null
 */
export function toEsm(code) {
  const names = Array.from(code.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)).map((m) => m[1])
  if (names.length === 0) return null
  const stripped = code.replace(/if \(typeof module !== 'undefined'\)[\s\S]*$/m, '')
  return `${stripped}\nexport { ${names.join(', ')} };\n`
}

/** 위 변환을 적용하는 Vite 플러그인. */
export function gasSharedModules() {
  return {
    name: 'gas-shared-modules',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0]
      if (!file.startsWith(sharedDir)) return null
      const out = toEsm(code)
      return out ? { code: out, map: null } : null
    },
  }
}
