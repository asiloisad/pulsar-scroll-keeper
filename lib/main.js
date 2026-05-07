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

        // initialize
        let recalculationAllowed = false;
        let firstRecalcuation = true;
        let hasStoredPosition = false;
        let lastUserAction = null;
        let storedAction = null;
        let cursorActionPending = false;
        let cursorActionTimer = null;

        const hasUsableLayout = () => {
          if (!component.measurements || !element.isConnected) {
            return false;
          }

          const bounds = element.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0;
        };

        const storePosition = (bufferRow, screenRow, action = lastUserAction) => {
          if (!hasUsableLayout()) {
            return;
          }

          const pixelPos = component.pixelPositionAfterBlocksForRow(screenRow);
          if (pixelPos === null) {
            return;
          }

          editor.focusedBufferRow = bufferRow;
          editor.focusedWindowOffset = pixelPos - component.scrollTop;
          hasStoredPosition = true;
          storedAction = action;
        };

        const storeCursorPosition = () => {
          if (lastUserAction !== "cursor") {
            return;
          }

          const cursor = editor.getLastCursor();
          if (!cursor) {
            return;
          }

          const screenRow = cursor.getScreenRow();
          if (screenRow === null) {
            return;
          }

          storePosition(cursor.getBufferRow(), screenRow, "cursor");
        };

        const storeCursorPositionSoon = debounce(storeCursorPosition, 0);

        const markCursorActionPending = () => {
          if (!hasUsableLayout()) {
            return;
          }

          cursorActionPending = true;
          if (cursorActionTimer) {
            clearTimeout(cursorActionTimer);
          }
          cursorActionTimer = setTimeout(() => {
            cursorActionPending = false;
            cursorActionTimer = null;
          }, 500);
        };

        const consumeCursorAction = () => {
          if (!cursorActionPending) {
            return false;
          }

          cursorActionPending = false;
          if (cursorActionTimer) {
            clearTimeout(cursorActionTimer);
            cursorActionTimer = null;
          }
          lastUserAction = "cursor";
          return true;
        };

        // hack soft-wrap recalculating
        const umswc = component.updateModelSoftWrapColumn.bind(component);
        component.updateModelSoftWrapColumn = () => {
          if (firstRecalcuation || recalculationAllowed) {
            umswc();
          }
          firstRecalcuation = false;
        };

        // recover position after .copy
        if (editor.parentBufferRow !== null && editor.parentBufferRow !== undefined) {
          requestAnimationFrame(() => {
            recalculationAllowed = true;
            component.updateSync();
            if (editor.parentBufferRow !== null) {
              let newScreenRow = editor.screenRowForBufferRow(editor.parentBufferRow);
              if (newScreenRow !== null) {
                let newPixelPos = component.pixelPositionAfterBlocksForRow(newScreenRow);
                if (newPixelPos !== null) {
                  component.setScrollTop(newPixelPos - editor.parentWindowOffset);
                  component.updateSync();
                  editor.focusedBufferRow = editor.parentBufferRow;
                  editor.focusedWindowOffset = editor.parentWindowOffset;
                  hasStoredPosition = true;
                  storedAction = "cursor";
                }
              }
            }
            recalculationAllowed = false;
            delete editor.parentBufferRow;
            delete editor.parentWindowOffset;
          });
        }

        // init position data, but lets consider editor.copy
        editor.focusedBufferRow = null;
        editor.focusedWindowOffset = null;

        // retrive position
        editor.retrivePosition = () => {
          requestAnimationFrame(() => {
            recalculationAllowed = true;
            component.updateSync();
            const hasCurrentAnchor =
              hasStoredPosition &&
              editor.focusedBufferRow !== null &&
              (lastUserAction === null || storedAction === lastUserAction);

            if (hasCurrentAnchor) {
              let newScreenRow = editor.screenRowForBufferRow(editor.focusedBufferRow);
              if (newScreenRow !== null) {
                let newPixelPos = component.pixelPositionAfterBlocksForRow(newScreenRow);
                if (newPixelPos !== null) {
                  component.setScrollTop(newPixelPos - editor.focusedWindowOffset);
                  component.updateSync();
                }
              }
            }
            recalculationAllowed = false;
          });
        };

        // hack cursor movement
        const storeCursorMovementPosition = debounce((event) => {
          if (lastUserAction !== "cursor") {
            return;
          }

          if (event.oldBufferPosition.compare(event.newBufferPosition) === 0) {
            return;
          }
          storePosition(event.newBufferPosition.row, event.newScreenPosition.row, "cursor");
        }, 100);

        disposables.add(
          editor.onDidChangeCursorPosition((event) => {
            if (!hasUsableLayout()) {
              return;
            }

            if (consumeCursorAction()) {
              storeCursorMovementPosition(event);
            }
          }),
        );

        const cursorMouseUpHandler = () => {
          if (!hasUsableLayout()) {
            return;
          }

          if (consumeCursorAction()) {
            storeCursorPositionSoon();
          }
        };

        element.addEventListener("mousedown", markCursorActionPending);
        element.addEventListener("mouseup", cursorMouseUpHandler);
        element.addEventListener("keydown", markCursorActionPending);

        // allow resoft while typing
        disposables.add(
          editor.buffer.onWillChange(() => {
            recalculationAllowed = true;
          }),
          editor.buffer.onDidChange(() => {
            recalculationAllowed = false;
          }),
        );

        // hack mouse scroll
        const storeScrollPosition = () => {
          if (!hasUsableLayout()) {
            return true;
          }

          const pixelPosition =
            component.scrollTop + component.measurements.clientContainerHeight / 2;
          const screenPosition = component.rowForPixelPosition(pixelPosition);
          if (screenPosition === null) {
            return true;
          }

          const bufferRow = editor.bufferRowForScreenRow(screenPosition);
          if (bufferRow === null) {
            return true;
          }

          storePosition(bufferRow, screenPosition, "scroll");
          return true;
        };

        const storeScrollPositionSoon = debounce(storeScrollPosition, 100);

        const scrollPatch = () => {
          lastUserAction = "scroll";
          requestAnimationFrame(() => {
            if (lastUserAction === "scroll") {
              storeScrollPosition();
            }
          });
          return storeScrollPositionSoon();
        };

        const smoothScrollStartedPatch = () => {
          lastUserAction = "scroll";
          return storeScrollPosition();
        };

        const smoothScrollPatch = () => {
          lastUserAction = "scroll";
          return storeScrollPositionSoon();
        };

        // standard scroll hack
        element.addEventListener("wheel", scrollPatch, { passive: true });
        element.addEventListener("mousewheel", scrollPatch, { passive: true });

        // smooth-scroll hack
        editor.emitter.on("scroll-animation-started", smoothScrollStartedPatch);
        editor.emitter.on("scroll-animation-updated", smoothScrollPatch);
        editor.emitter.on("scroll-animation-ended", smoothScrollStartedPatch);

        // external integration: recover position after execution completes
        // Uses debounce to batch rapid events (e.g., multiple cells executing)
        const requestHandler = debounce(() => {
          if (editor.retrivePosition) {
            editor.retrivePosition();
          }
        }, 50);
        editor.emitter.on("scroll-keeper-requested", requestHandler);

        // hack copy
        const copyOriginal = editor.copy.bind(editor);
        editor.copy = () => {
          const copied = copyOriginal();
          copied.parentBufferRow = editor.focusedBufferRow;
          copied.parentWindowOffset = editor.focusedWindowOffset;
          return copied;
        };

        // soft-wrap toggle hack
        disposables.add(
          editor.onDidChangeSoftWrapped(() => {
            editor.retrivePosition();
          }),
        );

        // editor-specific ResizeObserver for width changes
        let previousWidth = null;
        const resizeObserver = new ResizeObserver(
          debounce((entries) => {
            for (const entry of entries) {
              const currentWidth = entry.contentRect.width;
              if (previousWidth !== null && currentWidth !== previousWidth) {
                if (editor.retrivePosition) {
                  editor.retrivePosition();
                }
              }
              previousWidth = currentWidth;
            }
          }, 100),
        );
        resizeObserver.observe(element);

        // cleanup on editor destroy
        disposables.add(
          editor.onDidDestroy(() => {
            resizeObserver.disconnect();
            element.removeEventListener("wheel", scrollPatch, {
              passive: true,
            });
            element.removeEventListener("mousewheel", scrollPatch, {
              passive: true,
            });
            element.removeEventListener("mousedown", markCursorActionPending);
            element.removeEventListener("mouseup", cursorMouseUpHandler);
            element.removeEventListener("keydown", markCursorActionPending);
            if (cursorActionTimer) {
              clearTimeout(cursorActionTimer);
            }
            editor.emitter.off("scroll-animation-started", smoothScrollStartedPatch);
            editor.emitter.off("scroll-animation-updated", smoothScrollPatch);
            editor.emitter.off("scroll-animation-ended", smoothScrollStartedPatch);
            editor.emitter.off("scroll-keeper-requested", requestHandler);
            disposables.dispose();
            this.disposables.remove(disposables);
          }),
        );

        // clear if package disables
        this.disposables.add(disposables);

        // clear if editor destroyed
        editor.disposables.add(disposables);
      }),
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
