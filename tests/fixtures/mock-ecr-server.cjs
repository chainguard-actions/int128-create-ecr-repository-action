// Minimal mock of the Amazon ECR JSON API (awsJson1_1) for act tests.
// Usage: MOCK_PORT=18080 MOCK_LOG=/tmp/log.jsonl MOCK_EXISTING_REPOS=a,b node mock-ecr-server.cjs
const http = require('http')
const fs = require('fs')

const port = Number(process.env.MOCK_PORT || 18080)
const logFile = process.env.MOCK_LOG || '/tmp/mock-ecr-requests.jsonl'
const existing = new Set((process.env.MOCK_EXISTING_REPOS || '').split(',').filter(Boolean))
const account = '123456789012'
const region = 'us-east-1'

const repo = (name) => ({
  repositoryName: name,
  repositoryUri: `${account}.dkr.ecr.${region}.amazonaws.com/${name}`,
  repositoryArn: `arn:aws:ecr:${region}:${account}:repository/${name}`,
  registryId: account,
})

const send = (res, status, body, errorType) => {
  const headers = { 'Content-Type': 'application/x-amz-json-1.1', 'x-amzn-RequestId': 'mock-request-id' }
  if (errorType) headers['x-amzn-ErrorType'] = errorType
  res.writeHead(status, headers)
  res.end(JSON.stringify(body))
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', () => {
    const target = String(req.headers['x-amz-target'] || '')
    const op = target.split('.').pop()
    let body = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch (e) {
      body = { _raw: raw }
    }
    fs.appendFileSync(logFile, JSON.stringify({ op, body }) + '\n')

    switch (op) {
      case 'DescribeRepositories': {
        const name = (body.repositoryNames || [])[0]
        if (existing.has(name)) {
          send(res, 200, { repositories: [repo(name)] })
        } else {
          send(
            res,
            400,
            { __type: 'RepositoryNotFoundException', message: `The repository with name '${name}' does not exist` },
            'RepositoryNotFoundException',
          )
        }
        return
      }
      case 'CreateRepository': {
        existing.add(body.repositoryName)
        send(res, 200, { repository: repo(body.repositoryName) })
        return
      }
      case 'PutLifecyclePolicy':
        send(res, 200, {
          registryId: account,
          repositoryName: body.repositoryName,
          lifecyclePolicyText: body.lifecyclePolicyText,
        })
        return
      case 'SetRepositoryPolicy':
        send(res, 200, { registryId: account, repositoryName: body.repositoryName, policyText: body.policyText })
        return
      default:
        send(res, 400, { __type: 'InvalidParameterException', message: `unsupported op ${op}` }, 'InvalidParameterException')
    }
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`mock ECR listening on ${port}`)
})
