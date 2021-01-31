import marked from 'marked'
import readme from './readme' // generated from ../build.js

const isDev = process.env.NODE_ENV === 'development'
console.log(`isDev: ${isDev}`)
const BASE = 'https://api.github.com/repos/mistakia/record-docs/contents/'
const checkStatus = (response) => {
  if (response.status >= 200 && response.status < 300) {
    return response
  } else {
    const error = new Error(response.statusText)
    error.response = response
    throw error
  }
}

const main = document.getElementById('main')
const menuItems = []
const loadContent = (string) => {
  const html = marked(string)
  main.innerHTML = html
  const menu = document.getElementById('menu')
  const menuElems = document.querySelectorAll('h2')
  menuElems.forEach((elem) => {
    const menuItem = document.createElement('a')
    menuItem.text = elem.innerText
    menuItem.href = `#${elem.id}`
    menuItems.push(menuItem)
    menu.appendChild(menuItem)
  })
}

if (isDev) {
  loadContent(readme)
} else {
  fetch(`${BASE}/README.md`)
    .then(checkStatus)
    .then((res) => res.json())
    .then((json) => {
      const content = window.atob(json.content)
      loadContent(content)
    }).catch(function(error) {
      loadContent(readme)
    })
}
