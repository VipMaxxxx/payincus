import assert from 'node:assert/strict'
import { isValidRedirectUrl } from '../src/lib/redirect-validator.ts'

const validRedirects = ['/dashboard', '/a/b?x=1']
const invalidRedirects = [
    '//evil.com',
    '/\\evil.com',
    '/%5cevil.com',
    '/%2f%2fevil.com',
    '/\\tevil',
    'javascript:alert(1)',
    'https://evil.com',
    '',
    '/path\\x',
]

for (const redirect of validRedirects) {
    assert.equal(isValidRedirectUrl(redirect), true, `Expected redirect to be accepted: ${JSON.stringify(redirect)}`)
}

for (const redirect of invalidRedirects) {
    assert.equal(isValidRedirectUrl(redirect), false, `Expected redirect to be rejected: ${JSON.stringify(redirect)}`)
}

console.log('Redirect validator guard checks passed')
