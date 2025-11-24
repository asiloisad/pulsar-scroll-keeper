const { CompositeDisposable, Disposable } = require('atom')

module.exports = {

  activate() {
    this.disposables = new CompositeDisposable()

    // ===== patch text editors ===== //

    this.disposables.add(atom.workspace.observeTextEditors((editor) => {

      // initialize - track middle buffer row (not screen row!)
      editor.sp = { middleBufferRow: null }

      // wheel event listener define
      editor.sp.wheel = throttle(() => {
        if (editor.isDestroyed()) { return }
        // Get the screen row at viewport center
        const scrollTop = editor.component.getScrollTop()
        const viewportCenter = editor.component.getScrollContainerClientHeight() / 2
        const middlePixel = scrollTop + viewportCenter
        const middleScreenRow = editor.component.rowForPixelPosition(middlePixel)
        // Convert screen row to buffer row (stable across soft-wrap changes)
        editor.sp.middleBufferRow = editor.bufferRowForScreenRow(middleScreenRow)
      }, 250)

      // wheel event listener register
      editor.element.addEventListener('mousewheel', editor.sp.wheel)

      // wheel event listener dispose
      editor.disposables.add(new Disposable(() => {
        editor.element.removeEventListener('mousewheel', editor.sp.wheel)
      }))

      // cursor event define
      editor.sp.cursor = throttle((e) => {
        if (editor.isDestroyed()) { return }
        if (e.newBufferPosition.isEqual(e.oldBufferPosition)) { return }
        // Store the cursor's buffer row (stable across soft-wrap)
        editor.sp.middleBufferRow = editor.getLastCursor().getBufferPosition().row
      }, 250)

      // cursor event register & dispose
      editor.disposables.add(editor.onDidChangeCursorPosition(editor.sp.cursor))

      // create scroll method
      let newItem = true
      editor.sp.scroll = throttle(() => {
        if (newItem) {
          editor.scrollToCursorPosition()
          newItem = false
          // Store the buffer row at viewport center
          const scrollTop = editor.component.getScrollTop()
          const viewportCenter = editor.component.getScrollContainerClientHeight() / 2
          const middlePixel = scrollTop + viewportCenter
          const middleScreenRow = editor.component.rowForPixelPosition(middlePixel)
          editor.sp.middleBufferRow = editor.bufferRowForScreenRow(middleScreenRow)
          return
        }
        if (editor.isDestroyed()) {
          return
        }
        // Restore position based on buffer row (stable across soft-wrap changes)
        if (editor.sp.middleBufferRow != null) {
          // Convert buffer row back to current screen row (after soft-wrap changes)
          const middleScreenRow = editor.screenRowForBufferRow(editor.sp.middleBufferRow)
          const middleRowPixel = editor.component.pixelPositionAfterBlocksForRow(middleScreenRow)
          const viewportCenter = editor.component.getScrollContainerClientHeight() / 2
          const targetScrollTop = middleRowPixel - viewportCenter
          editor.component.setScrollTop(targetScrollTop)
          editor.component.scheduleUpdate()
        }
      }, 100)

      editor.disposables.add(editor.onDidChangeSoftWrapped(() => {
        editor.sp.scroll()
      }))
    }))

    // ===== patch panes ===== //

    this.disposables.add(atom.workspace.getCenter().observePanes((pane) => {
      // pane observer define
      const resizeObserver = new ResizeObserver(() => {
        for (let item of pane.getItems()) {
          if (atom.workspace.isTextEditor(item)) {
            item.sp.scroll()
          }
        }
      })

      // pane observer register
      resizeObserver.observe(pane.getElement())

      // pane observer dispose
      pane.onWillDestroy(() => { resizeObserver.disconnect() })
    }))

    // ===== observe font size ===== //

    this.disposables.add(atom.config.onDidChange('editor.fontSize', () => {
      for (let editor of atom.workspace.getTextEditors()) {
        editor.sp.scroll()
      }
    }))
  },

  deactivate() {
    this.disposables.dispose()
  },
}

function throttle(func, timeout) {
  let timer = false
  return (...args) => {
    if (timer) { return }
    timer = setTimeout(() => {
      func.apply(this, args)
      timer = false
    }, timeout)
  }
}
