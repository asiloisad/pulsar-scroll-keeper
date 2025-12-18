# scroll-keeper

Keep your focus on the same point as you resize panes. This package intelligently maintains your scroll position during window resizing, pane splitting, and soft-wrap changes. Integrates with smooth-scroll package (if installed).

- **Smart Scroll Preservation**: Maintains the cursor's visual position in the viewport during resize operations
- **Soft-Wrap Awareness**: Automatically adjusts scroll position when soft-wrap recalculates
- **Debounced Recalculation**: Reduces CPU usage during resize by waiting until you finish resizing (configurable delay)

## Installation

To install `scroll-keeper` search for [scroll-keeper](https://web.pulsar-edit.dev/packages/scroll-keeper) in the Install pane of the Pulsar settings or run `ppm install scroll-keeper`. Alternatively, you can run `ppm install asiloisad/pulsar-scroll-keeper` to install a package directly from the GitHub repository.

## How It Works

The package works best when soft-wrap is enabled, as this is when screen position differs from buffer position. When you resize a pane or split the editor:

1. **Before resize**: Records the cursor's position relative to the viewport top
2. **During resize**: Debounces soft-wrap recalculation to improve performance
3. **After resize**: Restores position so the cursor stays at the same visual location

# Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub — any feedback’s welcome!
