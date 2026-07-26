window.close()

const id = setTimeout(() => {
  document.body.innerText = 'If you see this message, this means oauth window is not closed, you can manually close it and report the bug to the developer.';
  clearTimeout(id)
}, 1000);