const { CompositeDisposable, Disposable } = require('atom')

module.exports = {

  activate() {
    this.disposables = new CompositeDisposable(
      // Observe debounce config changes
      atom.config.observe('scroll-keeper.debounceSoftWrap', (value) => {
        this.debounceSoftWrap = value
      })
    )

    // ===== patch text editors ===== //

    this.disposables.add(atom.workspace.observeTextEditors((editor) => {

      // Patch updateModelSoftWrapColumn to add debounce (configurable)
      const component = editor.component
      if (component && component.updateModelSoftWrapColumn) {
        const originalUpdateModelSoftWrapColumn = component.updateModelSoftWrapColumn.bind(component)
        const debouncedUpdateModelSoftWrapColumn = debounce(originalUpdateModelSoftWrapColumn, () => this.debounceSoftWrap)

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
      editor.scrollPositionTracker = {
        focusBufferRow: null,
        focusOffsetFromTop: null
      }

      // Function to update tracked position - tracks focus line (middle of viewport on scroll, cursor on cursor move)
      const updateTrackedPosition = (useCursor = false) => {
        if (editor.isDestroyed()) { return }

        let focusBufferRow, focusPixel
        const scrollTop = editor.component.getScrollTop()

        if (useCursor) {
          // Track cursor position
          const cursor = editor.getLastCursor()
          focusBufferRow = cursor.getBufferPosition().row
          const cursorScreenRow = editor.screenRowForBufferRow(focusBufferRow)
          focusPixel = editor.component.pixelPositionAfterBlocksForRow(cursorScreenRow)
        } else {
          // Track viewport middle
          const viewportCenter = editor.component.getScrollContainerClientHeight() / 2
          const middlePixel = scrollTop + viewportCenter
          const middleScreenRow = editor.component.rowForPixelPosition(middlePixel)
          // Validate screen row before converting to buffer row (prevent NaN errors)
          if (!Number.isFinite(middleScreenRow)) { return }
          focusBufferRow = editor.bufferRowForScreenRow(middleScreenRow)
          focusPixel = middlePixel
        }

        // Store buffer row and offset from top of viewport (stable across soft-wrap changes)
        editor.scrollPositionTracker.focusBufferRow = focusBufferRow
        editor.scrollPositionTracker.focusOffsetFromTop = focusPixel - scrollTop
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
        // Track cursor position (use cursor as focus line)
        updateTrackedPosition(true)
      }, 250)

      // Cursor event register & dispose
      editor.disposables.add(editor.onDidChangeCursorPosition(editor.scrollPositionTracker.onCursorMove))

      // Immediate scroll restoration logic (no throttle)
      const restoreScrollPosition = () => {
        if (editor.isDestroyed()) {
          return
        }
        // Restore focus line's relative position in viewport (stable across soft-wrap changes)
        if (editor.scrollPositionTracker.focusBufferRow != null &&
            editor.scrollPositionTracker.focusOffsetFromTop != null) {
          // Convert buffer row back to current screen row (after soft-wrap changes)
          const focusScreenRow = editor.screenRowForBufferRow(editor.scrollPositionTracker.focusBufferRow)
          const focusPixel = editor.component.pixelPositionAfterBlocksForRow(focusScreenRow)

          // Calculate new scroll position to maintain focus line's offset from top
          const targetScrollTop = focusPixel - editor.scrollPositionTracker.focusOffsetFromTop
          editor.component.setScrollTop(targetScrollTop)
          editor.component.scheduleUpdate()
        }
      }

      // Scroll restoration method (throttled for resize events)
      let newItem = true
      editor.scrollPositionTracker.restore = throttle(() => {
        if (newItem) {
          // On first open, track cursor position
          newItem = false
          updateTrackedPosition(true)
          return
        }
        restoreScrollPosition()
      }, 100)

      // Debounced restore for soft-wrap changes (configurable timeout)
      const debouncedSoftWrapRestore = debounce(restoreScrollPosition, () => this.debounceSoftWrap)

      editor.disposables.add(editor.onDidChangeSoftWrapped(debouncedSoftWrapRestore))
    }))

    // ===== patch panes ===== //

    this.disposables.add(atom.workspace.getCenter().observePanes((pane) => {
      // Pane resize observer with debounce (configurable timeout)
      const debouncedPaneResize = debounce(() => {
        for (let item of pane.getItems()) {
          if (atom.workspace.isTextEditor(item)) {
            item.scrollPositionTracker.restore()
          }
        }
      }, () => this.debounceSoftWrap)

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

function debounce(func, getTimeout) {
  let timer = null
  return (...args) => {
    if (timer) { clearTimeout(timer) }
    const timeout = typeof getTimeout === 'function' ? getTimeout() : getTimeout
    timer = setTimeout(() => {
      func.apply(this, args)
      timer = null
    }, timeout)
  }
}
