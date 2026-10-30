// Minimal mock of the Amazon ECR and ECR Public JSON 1.1 APIs.
// Env:
//   MOCK_PORT      port to listen on (default 4566)
//   MOCK_EXISTING  comma separated repository names that already exist
//   MOCK_LOG       file to append JSON lines of received calls
//   MOCK_READY     file to create when listening
import http from 'node:http'
import fs from 'node:fs'

const port = Number(process.env.MOCK_PORT || 4566)
const logFile = process.env.MOCK_LOG || '/tmp/mock-ecr-calls.log'
const readyFile = process.env.MOCK_READY || '/tmp/mock-ecr.ready'
const existing = new Set(
  (process.env.MOCK_EXISTING || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
)
const registryId = '123456789012'

const repoFor = (isPublic, name) => ({
  registryId,
  repositoryName: name,
  repositoryArn: isPublic
    ? `arn:aws:ecr-public::${registryId}:repository/${name}`
    : `arn:aws:ecr:us-east-1:${registryId}:repository/${name}`,
  repositoryUri: isPublic
    ? `public.ecr.aws/mockalias/${name}`
    : `${registryId}.dkr.ecr.us-east-1.amazonaws.com/${name}`,
})

const send = (res, status, obj, errorType) => {
  const headers = { 'Content-Type': 'application/x-amz-json-1.1', 'x-amzn-RequestId': 'mock-request-id' }
  if (errorType) headers['x-amzn-ErrorType'] = errorType
  res.writeHead(status, headers)
  res.end(JSON.stringify(obj))
}

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf-8')
    let body = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      body = {}
    }
    const target = String(req.headers['x-amz-target'] || '')
    const isPublic = target.startsWith('SpencerFrontendService')
    const op = target.split('.').pop()
    fs.appendFileSync(logFile, JSON.stringify({ target, op, isPublic, body }) + '\n')

    switch (op) {
      case 'DescribeRepositories': {
        const names = body.repositoryNames || []
        const found = names.filter((n) => existing.has(n))
        if (found.length !== names.length || names.length === 0) {
          return send(
            res,
            400,
            { __type: 'RepositoryNotFoundException', message: `The repository with name '${names[0]}' does not exist` },
            'RepositoryNotFoundException',
          )
        }
        return send(res, 200, { repositories: found.map((n) => repoFor(isPublic, n)) })
      }
      case 'CreateRepository': {
        existing.add(body.repositoryName)
        return send(res, 200, { repository: repoFor(isPublic, body.repositoryName) })
      }
      case 'PutLifecyclePolicy':
        return send(res, 200, {
          registryId,
          repositoryName: body.repositoryName,
          lifecyclePolicyText: body.lifecyclePolicyText,
        })
      case 'SetRepositoryPolicy':
        return send(res, 200, {
          registryId,
          repositoryName: body.repositoryName,
          policyText: body.policyText,
        })
      default:
        return send(res, 400, { __type: 'InvalidParameterException', message: `unsupported ${target}` }, 'InvalidParameterException')
    }
  })
})

server.listen(port, '127.0.0.1', () => {
  fs.writeFileSync(readyFile, 'ok')
  console.log(`mock ECR listening on ${port}`)
})
