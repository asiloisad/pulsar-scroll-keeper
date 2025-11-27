const { CompositeDisposable } = require("atom");

/**
 * Scroll Keeper Package
 * Preserves scroll position during soft-wrap recalculation.
 * Maintains cursor position relative to viewport during layout changes.
 */
module.exports = {
  /**
   * Activates the package and patches editors for scroll position preservation.
   */
  activate() {
    this.disposables = new CompositeDisposable();

    this.disposables.add(
      atom.workspace.observeTextEditors((editor) => {
        if (!editor) {
          return;
        }
        const element = editor.getElement();
        const component = editor.component;
        if (!component) {
          return;
        }

        const disposables = new CompositeDisposable();

        // hack soft-wrap recalculating
        let firstSoftWrapRecalcuation = true;
        component.recalculationAllowed = false;
        const umswc = component.updateModelSoftWrapColumn.bind(component);
        component.updateModelSoftWrapColumn = () => {
          if (firstSoftWrapRecalcuation || component.recalculationAllowed) {
            umswc();
          }
          firstSoftWrapRecalcuation = false;
        };

        // recover position after .copy
        if (editor.parentBufferRow) {
          requestAnimationFrame(() => {
            component.recalculationAllowed = true;
            component.updateSync();
            if (editor.parentBufferRow !== null) {
              let newScreenRow = editor.screenRowForBufferRow(
                editor.parentBufferRow
              );
              if (newScreenRow !== null) {
                let newPixelPos = component.pixelPositionAfterBlocksForRow(
                  newScreenRow
                );
                if (newPixelPos !== null) {
                  component.scrollTop = newPixelPos - editor.parentWindowOffset;
                  component.updateSync();
                  editor.focusedBufferRow = editor.parentBufferRow;
                  editor.focusedWindowOffset = editor.parentWindowOffset;
                }
              }
            }
            component.recalculationAllowed = false;
            delete editor.parentBufferRow;
            delete editor.parentWindowOffset;
          });
        }

        // init position data, but lets consider editor.copy
        editor.focusedBufferRow = null;
        editor.focusedWindowOffset = null;

        // retrive position
        editor.retrivePosition = () => {
          if (!editor.isSoftWrapped()) {
            return;
          }
          component.recalculationAllowed = true;
          component.updateSync();
          if (editor.focusedBufferRow !== null) {
            let newScreenRow = editor.screenRowForBufferRow(
              editor.focusedBufferRow
            );
            if (newScreenRow !== null) {
              let newPixelPos = component.pixelPositionAfterBlocksForRow(
                newScreenRow
              );
              if (newPixelPos !== null) {
                component.scrollTop = newPixelPos - editor.focusedWindowOffset;
                component.updateSync();
              }
            }
          }
          component.recalculationAllowed = false;
        };

        // hack cursor creation
        disposables.add(
          editor.observeCursors(
            debounce((cursor) => {
              if (!cursor) {
                return;
              }
              const screenRow = cursor.getScreenRow();
              if (screenRow === null) {
                return;
              }
              const pixelPos = component.pixelPositionAfterBlocksForRow(
                screenRow
              );
              if (pixelPos === null) {
                return;
              }

              editor.focusedBufferRow = cursor.getBufferRow();
              editor.focusedWindowOffset = pixelPos - component.scrollTop;
            }),
            100
          )
        );

        // hack cursor movement
        disposables.add(
          editor.onDidChangeCursorPosition(
            debounce((event) => {
              if (
                event.oldBufferPosition.compare(event.newBufferPosition) === 0
              ) {
                return;
              }
              const pixelPos = component.pixelPositionAfterBlocksForRow(
                event.newScreenPosition.row
              );
              if (pixelPos === null) {
                return;
              }

              editor.focusedBufferRow = event.newBufferPosition.row;
              editor.focusedWindowOffset = pixelPos - component.scrollTop;
            }, 100)
          )
        );

        // hack mouse scroll
        const scrollPatch = debounce(() => {
          if (!component.measurements) {
            return true;
          }
          const pixelPosition =
            component.scrollTop +
            component.measurements.clientContainerHeight / 2;
          const screenPosition = component.rowForPixelPosition(pixelPosition);
          if (screenPosition === null) {
            return true;
          }

          const bufferRow = editor.bufferRowForScreenRow(screenPosition);
          if (bufferRow === null) {
            return true;
          }

          const pixelPos = component.pixelPositionAfterBlocksForRow(
            screenPosition
          );
          if (pixelPos === null) {
            return true;
          }

          editor.focusedBufferRow = bufferRow;
          editor.focusedWindowOffset = pixelPos - component.scrollTop;
          return true;
        }, 100);

        // standard scroll hack
        element.addEventListener("mousewheel", scrollPatch, { passive: true });

        // smooth-scroll hack
        editor.emitter.on("scroll-animation-ended", scrollPatch);

        // hack copy
        const copyOriginal = editor.copy.bind(editor);
        editor.copy = () => {
          const copied = copyOriginal();
          copied.parentBufferRow = editor.focusedBufferRow;
          copied.parentWindowOffset = editor.focusedWindowOffset;
          return copied;
        };

        // cleanup on editor destroy
        disposables.add(
          editor.onDidDestroy(() => {
            element.removeEventListener("mousewheel", scrollPatch, {
              passive: true,
            });
            editor.emitter.off("scroll-animation-ended", scrollPatch);
            disposables.dispose();
            this.disposables.remove(disposables);
          })
        );

        // clear if package disables
        this.disposables.add(disposables);

        // clear if editor destroyed
        editor.disposables.add(disposables);
      })
    );

    // hack panes - use ResizeObserver to detect size changes
    this.disposables.add(
      atom.workspace.observePanes((pane) => {
        const paneElement = pane.getElement();
        if (!paneElement) {
          return;
        }

        const resizeObserver = new ResizeObserver(
          debounce(() => {
            for (const item of pane.getItems()) {
              if (atom.workspace.isTextEditor(item)) {
                const editor = item;
                if (editor.retrivePosition) {
                  editor.retrivePosition();
                }
              }
            }
          }, 100)
        );
        resizeObserver.observe(paneElement);

        const disposables = new CompositeDisposable();
        disposables.add(
          pane.onDidDestroy(() => {
            resizeObserver.disconnect();
            disposables.dispose();
            this.disposables.remove(disposables);
          })
        );

        this.disposables.add(disposables);
      })
    );
  },

  /**
   * Deactivates the package and disposes resources.
   */
  deactivate() {
    if (this.disposables) {
      this.disposables.dispose();
      this.disposables = null;
    }
  },
};

/**
 * Creates a debounced version of a function.
 * @param {Function} func - The function to debounce
 * @param {number} timeout - The debounce timeout in milliseconds
 * @returns {Function} The debounced function
 */
function debounce(func, timeout) {
  let timer = null;
  return (...args) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      func.apply(this, args);
      timer = null;
    }, timeout);
  };
}
