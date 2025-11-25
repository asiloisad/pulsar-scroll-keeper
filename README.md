# scroll-keeper

Keep your focus on the same point as you resize panes. This package intelligently maintains your scroll position during window resizing, pane splitting, and soft-wrap changes. Integrates with smooth-scroll package (if installed).

- **Smart Scroll Preservation**: Maintains the cursor's visual position in the viewport during resize operations
- **Soft-Wrap Awareness**: Automatically adjusts scroll position when soft-wrap recalculates
- **Debounced Recalculation**: Reduces CPU usage during resize by waiting until you finish resizing (configurable delay)
- **Smooth-Scroll Integration**: Works seamlessly with the smooth-scroll package
- **Multiple Trigger Support**: Tracks scroll position on wheel events, cursor movements, and resize operations

## Installation

To install `scroll-keeper` search for [scroll-keeper](https://web.pulsar-edit.dev/packages/scroll-keeper) in the Install pane of the Pulsar settings or run `ppm install scroll-keeper`. Alternatively, you can run `ppm install asiloisad/pulsar-scroll-keeper` to install a package directly from the GitHub repository.

## How It Works

The package works best when soft-wrap is enabled, as this is when screen position differs from buffer position. When you resize a pane or split the editor:

1. **Before resize**: Records the cursor's position relative to the viewport top
2. **During resize**: Debounces soft-wrap recalculation to improve performance
3. **After resize**: Restores scroll position so the cursor stays at the same visual location

## Debounce Soft Wrap (ms)

**Default**: 150ms
**Range**: 0-1000ms

Delay in milliseconds before recalculating soft-wrap after resize stops. Higher values reduce CPU usage during resize but delay the final wrap adjustment.

- **0ms**: Instant recalculation (may cause lag during resize)
- **50-100ms**: Responsive with minimal delay
- **150ms** (default): Good balance between performance and responsiveness
- **300-500ms**: Noticeable delay but best for slower systems

To adjust: `Settings → Packages → scroll-keeper → Debounce Soft Wrap`

# Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub — any feedback’s welcome!
