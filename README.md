# scroll-keeper

Maintain scroll position during pane resizing. Keeps your cursor at the same visual position when soft-wrap recalculates.

## Features

- **Position preservation**: Maintains cursor's visual position during resize.
- **Soft-wrap aware**: Adjusts scroll when soft-wrap recalculates.
- **Debounced**: Reduces CPU usage during resize operations.
- **smooth-scroll integration**: Works with [smooth-scroll](https://github.com/asiloisad/pulsar-smooth-scroll) if installed.

## Installation

To install `scroll-keeper` search for [scroll-keeper](https://web.pulsar-edit.dev/packages/scroll-keeper) in the Install pane of the Pulsar settings or run `ppm install scroll-keeper`. Alternatively, you can run `ppm install asiloisad/pulsar-scroll-keeper` to install a package directly from the GitHub repository.

## How it works

The package works best when soft-wrap is enabled, as this is when screen position differs from buffer position. When you resize a pane or split the editor:

1. **Before resize**: Records the cursor's position relative to the viewport top
2. **During resize**: Debounces soft-wrap recalculation to improve performance
3. **After resize**: Restores position so the cursor stays at the same visual location

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub — any feedback's welcome!
