const marked = require('marked')
const fs = require('fs')

const readme = fs.readFileSync('./README.md')
const html = marked(readme.toString())

const content = `module.exports = ${JSON.stringify(html)}`
fs.writeFileSync('./src/readme.js', content)
