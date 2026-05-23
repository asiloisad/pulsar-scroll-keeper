const { CompositeDisposable, Disposable } = require("atom");

module.exports = {
  activate() {
    this.disposables = new CompositeDisposable();
    this.copiedEditorAnchors = new WeakMap();
    this.editorAnchors = new WeakMap();

    this.disposables.add(
      atom.workspace.observeTextEditors((editor) => {
        if (!editor) {
          return;
        }

        const element = editor.getElement();
        if (!element) {
          return;
        }

        const buffer = editor.getBuffer();
        if (!buffer) {
          return;
        }

        const component = editor.component;
        if (!component) {
          return;
        }

        const disposables = new CompositeDisposable();

        // Soft-wrap recalculation is normally suppressed during layout churn
        // and briefly allowed when content or viewport state really changes.
        let recalculationAllowed = false;
        let firstRecalcuation = true;
        const updateModelSoftWrapColumn = component.updateModelSoftWrapColumn.bind(component);
        component.updateModelSoftWrapColumn = () => {
          if (firstRecalcuation || recalculationAllowed) {
            updateModelSoftWrapColumn();
          }
          firstRecalcuation = false;
        };

        // New editor copies inherit the parent editor's saved visual anchor.
        const copiedEditorAnchor = this.copiedEditorAnchors.get(editor);
        if (copiedEditorAnchor) {
          requestAnimationFrame(() => {
            recalculationAllowed = true;
            component.updateSync();
            if (copiedEditorAnchor.bufferPosition !== null) {
              let newScreenPosition = editor.screenPositionForBufferPosition(
                copiedEditorAnchor.bufferPosition,
              );
              if (newScreenPosition !== null) {
                let newPixelPos = component.pixelPositionAfterBlocksForRow(newScreenPosition.row);
                if (newPixelPos !== null) {
                  component.setScrollTop(newPixelPos - copiedEditorAnchor.windowOffset);
                  component.updateSync();
                  this.editorAnchors.set(editor, copiedEditorAnchor);
                }
              }
            }
            recalculationAllowed = false;
            if (this.copiedEditorAnchors) {
              this.copiedEditorAnchors.delete(editor);
            }
          });
        }

        // Store the editor's visual anchor outside the editor object.
        if (!copiedEditorAnchor) {
          this.editorAnchors.set(editor, {
            bufferPosition: null,
            windowOffset: null,
          });
        }

        // Restore the saved visual anchor after asynchronous layout changes.
        const restorePosition = () => {
          requestAnimationFrame(() => {
            recalculationAllowed = true;
            component.updateSync();
            const anchor = this.editorAnchors && this.editorAnchors.get(editor);
            if (anchor && anchor.bufferPosition !== null) {
              let newScreenPosition = editor.screenPositionForBufferPosition(anchor.bufferPosition);
              if (newScreenPosition !== null) {
                let newPixelPos = component.pixelPositionAfterBlocksForRow(newScreenPosition.row);
                if (newPixelPos !== null) {
                  component.setScrollTop(newPixelPos - anchor.windowOffset);
                  component.updateSync();
                }
              }
            }
            recalculationAllowed = false;
          });
        };

        // Cursor creation can establish the first anchor for the viewport.
        disposables.add(
          editor.onDidAddCursor(
            debounce((cursor) => {
              if (!cursor) {
                return;
              }
              const screenRow = cursor.getScreenRow();
              if (screenRow === null) {
                return;
              }
              const pixelPos = component.pixelPositionAfterBlocksForRow(screenRow);
              if (pixelPos === null) {
                return;
              }
              if (!this.editorAnchors) {
                return;
              }

              this.editorAnchors.set(editor, {
                bufferPosition: cursor.getBufferPosition(),
                windowOffset: pixelPos - component.scrollTop,
              });
            }),
            100,
          ),
        );

        // Cursor movement refreshes the anchor used by later restorations.
        disposables.add(
          editor.onDidChangeCursorPosition(
            debounce((event) => {
              if (event.oldBufferPosition.compare(event.newBufferPosition) === 0) {
                return;
              }
              const pixelPos = component.pixelPositionAfterBlocksForRow(
                event.newScreenPosition.row,
              );
              if (pixelPos === null) {
                return;
              }
              if (!this.editorAnchors) {
                return;
              }

              this.editorAnchors.set(editor, {
                bufferPosition: event.newBufferPosition,
                windowOffset: pixelPos - component.scrollTop,
              });
            }, 100),
          ),
        );

        // Patch display-layer updates because Pulsar has already translated
        // buffer edits into this editor's screen-row coordinates here.
        const didChangeDisplayLayerOriginal = component.didChangeDisplayLayer.bind(component);
        disposables.add(
          new Disposable(() => {
            component.didChangeDisplayLayer = didChangeDisplayLayerOriginal;
          }),
        );

        component.didChangeDisplayLayer = (changes) => {
          let scrollDelta = 0;

          // Only sibling editors need compensation. The source editor should
          // keep its native typing/scroll behavior.
          if (component.measurements) {
            const firstVisibleRow = component.getFirstVisibleRow();

            // Changes above the viewport shift visible rows; compensate by the
            // same screen-row delta after Pulsar updates its line index.
            for (const { oldRange, newRange } of changes) {
              if (newRange.start.row >= firstVisibleRow) {
                continue;
              }
              const oldRows = oldRange.end.row - oldRange.start.row;
              const newRows = newRange.end.row - newRange.start.row;
              scrollDelta += newRows - oldRows;
            }
          }

          didChangeDisplayLayerOriginal(changes);

          if (scrollDelta !== 0) {
            const lineHeight = component.getLineHeight();
            if (lineHeight) {
              component.setScrollTop(component.getScrollTop() + scrollDelta * lineHeight);
            }
          }
        };

        // Content edits are allowed to trigger soft-wrap recalculation.
        disposables.add(
          buffer.onWillChange(() => {
            recalculationAllowed = true;
          }),
          buffer.onDidChange(() => {
            recalculationAllowed = false;
          }),
        );

        // Manual scrolling changes the user's visual anchor.
        const scrollPatch = debounce(() => {
          if (!component.measurements) {
            return true;
          }
          const pixelPosition =
            component.scrollTop + component.measurements.clientContainerHeight / 2;
          const screenRow = component.rowForPixelPosition(pixelPosition);
          if (screenRow === null) {
            return true;
          }

          const bufferPosition = editor.bufferPositionForScreenPosition([screenRow, 0]);
          if (bufferPosition === null) {
            return true;
          }

          const pixelPos = component.pixelPositionAfterBlocksForRow(screenRow);
          if (pixelPos === null) {
            return true;
          }
          if (!this.editorAnchors) {
            return true;
          }

          this.editorAnchors.set(editor, {
            bufferPosition,
            windowOffset: pixelPos - component.scrollTop,
          });
          return true;
        }, 100);

        // Native wheel scrolling.
        element.addEventListener("mousewheel", scrollPatch, { passive: true });

        // smooth-scroll emits this after animated scrolling settles.
        editor.emitter.on("scroll-animation-ended", scrollPatch);

        // external integration: recover position after execution completes
        // Uses debounce to batch rapid events (e.g., multiple cells executing)
        const requestHandler = debounce(restorePosition, 50);
        editor.emitter.on("scroll-keeper-requested", requestHandler);

        // Preserve the saved anchor when Pulsar clones an editor into a split.
        const copyOriginal = editor.copy.bind(editor);
        editor.copy = () => {
          const copied = copyOriginal();
          const anchor = this.editorAnchors && this.editorAnchors.get(editor);
          if (
            this.copiedEditorAnchors &&
            anchor &&
            anchor.bufferPosition !== null &&
            anchor.windowOffset !== null
          ) {
            this.copiedEditorAnchors.set(copied, {
              bufferPosition: anchor.bufferPosition,
              windowOffset: anchor.windowOffset,
            });
          }
          return copied;
        };
        disposables.add(
          new Disposable(() => {
            editor.copy = copyOriginal;
          }),
        );

        // Toggling soft-wrap changes screen rows without changing buffer rows.
        disposables.add(
          editor.onDidChangeSoftWrapped(() => {
            restorePosition();
          }),
        );

        // Width changes can alter soft-wrap and therefore screen-row geometry.
        let previousWidth = null;
        const resizeObserver = new ResizeObserver(
          debounce((entries) => {
            for (const entry of entries) {
              const currentWidth = entry.contentRect.width;
              if (previousWidth !== null && currentWidth !== previousWidth) {
                restorePosition();
              }
              previousWidth = currentWidth;
            }
          }, 100),
        );
        resizeObserver.observe(element);

        // Tear down DOM listeners and component patches with the editor.
        disposables.add(
          editor.onDidDestroy(() => {
            resizeObserver.disconnect();
            element.removeEventListener("mousewheel", scrollPatch, {
              passive: true,
            });
            editor.emitter.off("scroll-animation-ended", scrollPatch);
            editor.emitter.off("scroll-keeper-requested", requestHandler);
            disposables.dispose();
            this.disposables.remove(disposables);
          }),
        );

        // Package deactivation disposes all per-editor resources.
        this.disposables.add(disposables);

        // Editor destruction also owns these per-editor resources.
        editor.disposables.add(disposables);
      }),
    );
  },

  deactivate() {
    this.disposables.dispose();
    this.copiedEditorAnchors = null;
    this.editorAnchors = null;
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
