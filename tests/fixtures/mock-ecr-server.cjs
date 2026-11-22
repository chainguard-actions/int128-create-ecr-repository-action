// Minimal mock of the Amazon ECR / ECR Public JSON APIs (awsJson1_1) for tests.
// Usage: MOCK_MODE=exists|notfound node mock-ecr-server.cjs <port> <logfile>
'use strict'
const http = require('node:http')
const fs = require('node:fs')

const port = Number(process.argv[2] || 4566)
const logFile = process.argv[3] || '/tmp/mock-ecr.log'
const mode = process.env.MOCK_MODE || 'exists'
const created = new Set()

const uriFor = (target, name) =>
  target.startsWith('SpencerFrontendService')
    ? `public.ecr.aws/abcd1234/${name}`
    : `123456789012.dkr.ecr.us-east-1.amazonaws.com/${name}`

const repoFor = (target, name) => ({
  registryId: '123456789012',
  repositoryName: name,
  repositoryArn: `arn:aws:ecr:us-east-1:123456789012:repository/${name}`,
  repositoryUri: uriFor(target, name),
})

const send = (res, status, obj, errType) => {
  const headers = { 'Content-Type': 'application/x-amz-json-1.1', 'x-amzn-RequestId': 'mock-request-id' }
  if (errType) headers['x-amzn-ErrorType'] = errType
  res.writeHead(status, headers)
  res.end(JSON.stringify(obj))
}

http
  .createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      if (req.method !== 'POST') {
        res.writeHead(200)
        res.end('ok')
        return
      }
      const target = String(req.headers['x-amz-target'] || '')
      let body = {}
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch (e) {}
      fs.appendFileSync(logFile, `${target} ${JSON.stringify(body)}\n`)
      const op = target.split('.').pop()
      switch (op) {
        case 'DescribeRepositories': {
          const name = (body.repositoryNames || [])[0]
          if (mode === 'notfound' && !created.has(name)) {
            return send(
              res,
              400,
              { __type: 'RepositoryNotFoundException', message: `The repository with name '${name}' does not exist` },
              'RepositoryNotFoundException',
            )
          }
          return send(res, 200, { repositories: [repoFor(target, name)] })
        }
        case 'CreateRepository': {
          created.add(body.repositoryName)
          return send(res, 200, { repository: repoFor(target, body.repositoryName) })
        }
        case 'PutLifecyclePolicy':
          return send(res, 200, {
            registryId: '123456789012',
            repositoryName: body.repositoryName,
            lifecyclePolicyText: body.lifecyclePolicyText,
          })
        case 'SetRepositoryPolicy':
          return send(res, 200, {
            registryId: '123456789012',
            repositoryName: body.repositoryName,
            policyText: body.policyText,
          })
        default:
          return send(res, 400, { __type: 'InvalidParameterException', message: `unsupported ${target}` }, 'InvalidParameterException')
      }
    })
  })
  .listen(port, '127.0.0.1', () => console.log(`mock ECR listening on ${port} (mode=${mode})`))
