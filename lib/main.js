module.exports = {

  activate() {
    atom.workspace.observeTextEditors((editor) => {
      if (!editor) { return }
      const element = editor.getElement()
      const component = editor.component

      // hack soft-wrap recalculating
      component.recalculationAllowed = false
      const umswc = component.updateModelSoftWrapColumn.bind(component)
      component.updateModelSoftWrapColumn = () => {
        if (component.recalculationAllowed) { umswc() }
      }

      // recover position after .copy
      if (editor.parentBufferRow && editor.isSoftWrapped()) {
        requestAnimationFrame(() => {
          component.recalculationAllowed = true
          component.updateSync()
          if (editor.parentBufferRow!==null) {
            let newScreenRow = editor.screenRowForBufferRow(editor.parentBufferRow)
            let newPixeelPos = component.pixelPositionAfterBlocksForRow(newScreenRow)
            component.scrollTop = newPixeelPos-editor.parentWindowOffset
            component.updateSync()
          }
          component.recalculationAllowed = false
          delete editor.parentBufferRow
          delete editor.parentWindowOffset
        })
      }

      // init position data, but lets consider editor.copy
      editor.focusedBufferRow = null
      editor.focusedWindowOffset = null

      // retrive position
      editor.retrivePosition = debounce(() => {
          if (!editor.isSoftWrapped()) { return }
          component.recalculationAllowed = true
          component.updateSync()
          if (editor.focusedBufferRow!==null) {
            let newScreenRow = editor.screenRowForBufferRow(editor.focusedBufferRow)
            let newPixeelPos = component.pixelPositionAfterBlocksForRow(newScreenRow)
            component.scrollTop = newPixeelPos-editor.focusedWindowOffset
            component.updateSync()
          }
          component.recalculationAllowed = false
      }, 50)

      // hack cursor creation
      editor.observeCursors((cursor) => {

        editor.focusedBufferRow = cursor.getBufferRow()
        editor.focusedWindowOffset = (
          component.pixelPositionAfterBlocksForRow(cursor.getScreenRow())
          -
          component.scrollTop
        )
      })

      // hack cursor movement
      editor.onDidChangeCursorPosition((event) => {
        if (event.oldBufferPosition.compare(event.newBufferPosition)===0) {
          return
        }
        editor.focusedBufferRow = event.newBufferPosition.row
        editor.focusedWindowOffset = (
          component.pixelPositionAfterBlocksForRow(event.newScreenPosition.row)
          -
          component.scrollTop
        )
      })

      // hack mouse scroll
      const wheelPatch = () => {
        const pixelPosition = (
          component.scrollTop
          +
          component.measurements.clientContainerHeight/2
        )
        const screenPosition = component.rowForPixelPosition(pixelPosition)
        editor.focusedBufferRow = editor.bufferRowForScreenRow(screenPosition)
        editor.focusedWindowOffset = (
          component.pixelPositionAfterBlocksForRow(screenPosition)
          -
          component.scrollTop
        )
      }

      // standard scroll hack
      element.addEventListener('wheel', wheelPatch)

      // smooth-scroll hack
      editor.emitter.on('scroll-animation-ended', wheelPatch)

      // hack copy
      const copyOriginal = editor.copy.bind(editor)
      editor.copy = () => {
        const copied = copyOriginal()
        copied.parentBufferRow = editor.focusedBufferRow
        copied.parentWindowOffset = editor.focusedWindowOffset
        return copied
      }
    })

    // hack panes
    atom.workspace.observePanes((pane) => {
      pane.onDidChangeFlexScale((flexScale) => {
        for (const item of pane.getItems()) {
          if (atom.workspace.isTextEditor(item)) {
            const editor = item
            editor.retrivePosition()
          }
        }
      })
    })
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
