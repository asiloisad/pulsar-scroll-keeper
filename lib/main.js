const { CompositeDisposable, Disposable } = require('atom')

module.exports = {

  activate() {
    this.disposables = new CompositeDisposable()

    // ===== patch text editors ===== //

    this.disposables.add(atom.workspace.observeTextEditors((editor) => {

      // Patch updateModelSoftWrapColumn to add debounce (200ms default)
      const component = editor.component
      if (component && component.updateModelSoftWrapColumn) {
        const originalUpdateModelSoftWrapColumn = component.updateModelSoftWrapColumn.bind(component)
        const debouncedUpdateModelSoftWrapColumn = debounce(originalUpdateModelSoftWrapColumn, 200)

        component.updateModelSoftWrapColumn = function() {
          debouncedUpdateModelSoftWrapColumn()
        }

        // Restore original method on editor destroy
        editor.disposables.add(new Disposable(() => {
          if (component) {
            component.updateModelSoftWrapColumn = originalUpdateModelSoftWrapColumn
          }
        }))
      }

      // Initialize scroll position tracker
      editor.scrollPositionTracker = { middleBufferRow: null }

      // Function to update tracked position based on current scroll
      const updateTrackedPosition = () => {
        if (editor.isDestroyed()) { return }
        // Get the screen row at viewport center
        const scrollTop = editor.component.getScrollTop()
        const viewportCenter = editor.component.getScrollContainerClientHeight() / 2
        const middlePixel = scrollTop + viewportCenter
        const middleScreenRow = editor.component.rowForPixelPosition(middlePixel)
        // Validate screen row before converting to buffer row (prevent NaN errors)
        if (Number.isFinite(middleScreenRow)) {
          // Convert screen row to buffer row (stable across soft-wrap changes)
          editor.scrollPositionTracker.middleBufferRow = editor.bufferRowForScreenRow(middleScreenRow)
        }
      }

      // Wheel event listener - update tracked position on scroll
      editor.scrollPositionTracker.onWheel = throttle(updateTrackedPosition, 250)

      // Smooth-scroll integration - hook called when smooth-scroll animation completes
      editor.sp = { wheel: updateTrackedPosition }

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

      // Immediate scroll restoration logic (no throttle)
      const restoreScrollPosition = () => {
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
      }

      // Scroll restoration method (throttled for resize events)
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
          // Validate screen row before converting to buffer row (prevent NaN errors)
          if (Number.isFinite(middleScreenRow)) {
            editor.scrollPositionTracker.middleBufferRow = editor.bufferRowForScreenRow(middleScreenRow)
          }
          return
        }
        restoreScrollPosition()
      }, 100)

      // Debounced restore for soft-wrap changes (wait 200ms after last change)
      const debouncedSoftWrapRestore = debounce(restoreScrollPosition, 200)

      editor.disposables.add(editor.onDidChangeSoftWrapped(debouncedSoftWrapRestore))
    }))

    // ===== patch panes ===== //

    this.disposables.add(atom.workspace.getCenter().observePanes((pane) => {
      // Pane resize observer with debounce (wait 200ms after last resize)
      const debouncedPaneResize = debounce(() => {
        for (let item of pane.getItems()) {
          if (atom.workspace.isTextEditor(item)) {
            item.scrollPositionTracker.restore()
          }
        }
      }, 200)

      const resizeObserver = new ResizeObserver(debouncedPaneResize)

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

function debounce(func, timeout) {
  let timer = null
  return (...args) => {
    if (timer) { clearTimeout(timer) }
    timer = setTimeout(() => {
      func.apply(this, args)
      timer = null
    }, timeout)
  }
}
