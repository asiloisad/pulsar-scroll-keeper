const { CompositeDisposable, Disposable } = require('atom')

module.exports = {

  activate() {
    this.disposables = new CompositeDisposable()

    // ===== patch text editors ===== //

    this.disposables.add(atom.workspace.observeTextEditors((editor) => {

      // Initialize scroll position tracker
      editor.scrollPositionTracker = { middleBufferRow: null }

      // Wheel event listener - update tracked position on scroll
      editor.scrollPositionTracker.onWheel = throttle(() => {
        if (editor.isDestroyed()) { return }
        // Get the screen row at viewport center
        const scrollTop = editor.component.getScrollTop()
        const viewportCenter = editor.component.getScrollContainerClientHeight() / 2
        const middlePixel = scrollTop + viewportCenter
        const middleScreenRow = editor.component.rowForPixelPosition(middlePixel)
        // Convert screen row to buffer row (stable across soft-wrap changes)
        editor.scrollPositionTracker.middleBufferRow = editor.bufferRowForScreenRow(middleScreenRow)
      }, 250)

      // Wheel event listener register
      editor.element.addEventListener('mousewheel', editor.scrollPositionTracker.onWheel)

      // Wheel event listener dispose
      editor.disposables.add(new Disposable(() => {
        editor.element.removeEventListener('mousewheel', editor.scrollPositionTracker.onWheel)
      }))

      // Cursor event - update tracked position on cursor move
      editor.scrollPositionTracker.onCursorMove = throttle((e) => {
        if (editor.isDestroyed()) { return }
        if (e.newBufferPosition.isEqual(e.oldBufferPosition)) { return }
        // Store the cursor's buffer row (stable across soft-wrap)
        editor.scrollPositionTracker.middleBufferRow = editor.getLastCursor().getBufferPosition().row
      }, 250)

      // Cursor event register & dispose
      editor.disposables.add(editor.onDidChangeCursorPosition(editor.scrollPositionTracker.onCursorMove))

      // Scroll restoration method
      let newItem = true
      editor.scrollPositionTracker.restore = throttle(() => {
        if (newItem) {
          editor.scrollToCursorPosition()
          newItem = false
          // Store the buffer row at viewport center
          const scrollTop = editor.component.getScrollTop()
          const viewportCenter = editor.component.getScrollContainerClientHeight() / 2
          const middlePixel = scrollTop + viewportCenter
          const middleScreenRow = editor.component.rowForPixelPosition(middlePixel)
          editor.scrollPositionTracker.middleBufferRow = editor.bufferRowForScreenRow(middleScreenRow)
          return
        }
        if (editor.isDestroyed()) {
          return
        }
        // Restore position based on buffer row (stable across soft-wrap changes)
        if (editor.scrollPositionTracker.middleBufferRow != null) {
          // Convert buffer row back to current screen row (after soft-wrap changes)
          const middleScreenRow = editor.screenRowForBufferRow(editor.scrollPositionTracker.middleBufferRow)
          const middleRowPixel = editor.component.pixelPositionAfterBlocksForRow(middleScreenRow)
          const viewportCenter = editor.component.getScrollContainerClientHeight() / 2
          const targetScrollTop = middleRowPixel - viewportCenter
          editor.component.setScrollTop(targetScrollTop)
          editor.component.scheduleUpdate()
        }
      }, 100)

      editor.disposables.add(editor.onDidChangeSoftWrapped(() => {
        editor.scrollPositionTracker.restore()
      }))

      // ===== Freeze soft-wrap during resize ===== //

      if (editor.component) {
        // Patch updateModelSoftWrapColumn to block recalculation during resize
        const originalUpdateModelSoftWrapColumn = editor.component.updateModelSoftWrapColumn.bind(editor.component)

        let isResizing = false
        let resizeTimer = null

        editor.component.updateModelSoftWrapColumn = function () {
          // Block soft-wrap recalculation during resize
          if (isResizing) {
            return
          }
          return originalUpdateModelSoftWrapColumn()
        }

        // Track resize state by observing the pane element
        const pane = atom.workspace.paneForItem(editor)
        if (pane) {
          const paneResizeObserver = new ResizeObserver(() => {
            // Mark as resizing
            isResizing = true

            // Clear existing timer
            if (resizeTimer) {
              clearTimeout(resizeTimer)
            }

            // Set timer to unfreeze after resizing stops
            resizeTimer = setTimeout(() => {
              isResizing = false
              resizeTimer = null

              // Trigger soft-wrap recalculation and restore position
              if (!editor.isDestroyed()) {
                originalUpdateModelSoftWrapColumn()
                editor.scrollPositionTracker.restore()
              }
            }, atom.config.get('scroll-keeper.debounceSoftWrap'))
          })

          paneResizeObserver.observe(pane.getElement())

          // Cleanup
          editor.disposables.add(new Disposable(() => {
            paneResizeObserver.disconnect()
          }))
        }
      }
    }))

    // ===== patch panes ===== //

    this.disposables.add(atom.workspace.getCenter().observePanes((pane) => {
      // Pane resize observer
      const resizeObserver = new ResizeObserver(() => {
        for (let item of pane.getItems()) {
          if (atom.workspace.isTextEditor(item)) {
            item.scrollPositionTracker.restore()
          }
        }
      })

      // Pane observer register
      resizeObserver.observe(pane.getElement())

      // Pane observer dispose
      pane.onWillDestroy(() => { resizeObserver.disconnect() })
    }))

    // ===== observe font size ===== //

    this.disposables.add(atom.config.onDidChange('editor.fontSize', () => {
      for (let editor of atom.workspace.getTextEditors()) {
        editor.scrollPositionTracker.restore()
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
