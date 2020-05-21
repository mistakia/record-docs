import marked from 'marked'
import readme from './readme' // generated from ../build.js

const BASE = 'https://api.github.com/repos/mistakia/record-docs/contents/'

const getURL = (file) => {
  return `${BASE}/${file}.md`
}

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

fetch(getURL('README'))
  .then(checkStatus)
  .then((res) => res.json())
  .then((json) => {
    const content = window.atob(json.content)
    loadContent(content)
  }).catch(function(error) {
    loadContent(readme)
  })


const throttle = (func, timeout) => {
  let wait = false

  return function (...args) {
    if (!wait) {
      func(...args)
      wait = true

      setTimeout(function () {
        wait = false
        func(...args)
      }, timeout)
    }
  }
}

const onScroll = () => {
  let fromTop = window.scrollY + 10
  console.log('fromTop:', fromTop)
  menuItems.forEach((link, index) => {
    let section = document.querySelector(link.hash)

    let nextLink = menuItems[index + 1]
    let nextSection = nextLink ? document.querySelector(nextLink.hash) : null
    if (
      section.offsetTop <= fromTop &&
        (nextSection ? nextSection.offsetTop > fromTop : true)
    ) {
      link.classList.add('active')
    } else {
      link.classList.remove('active')
    }
  })
}

const throttledScroll = throttle(onScroll, 500)
//window.addEventListener('scroll', throttledScroll)
