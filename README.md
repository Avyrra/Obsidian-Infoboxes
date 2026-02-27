# How to Install
This plugin is not yet on the community plugins browser, however it can still be installed and updated via the BRAT plugin.

1. Enable Community plugins in obsidian and install the BRAT plugin. Enable it.
2. Open the BRAT plugin options and scroll down to "Beta plugin list"
3. Click add beta plugin
4. Copy and paste this repository's URL into the window that appears
5. Select latest version
6. Click Add Plugin

## How to Customize
1. Install and enable Style Settings from the community plugins.
2. In the Style Settings menu, a new section called "Infoboxes" will be added. Click on it to reveal customization options.


# What if I used the snippet version?
This plugin uses the same classes that the snippet does under the hood. If you previously used the snippet version, all your old notes should still appear as infoboxes without needed modifications. (Message me if this is not the case for you and I'll look into it to see if it's my fault). There are some differences however, mostly in the appearance settings.

Do note, you will likely have to reconfigure your settings if you modified them via style settings.

## What's different from the snippet?
For starters, you no longer have to type html classes, cluttering up your notes. Use // to create a section. To create a label, type the name of the label, then type -> to add information.

The default appearance has changed. Gone is my weird, yet somewhat whimsical, green preset. The new defaults match the default obsidian theme quite a bit better.

The color selectors are gone in favor of variable text. Personally, I found the color selectors to be a bit difficult to use. This allows you to have more flexibility in customizing your infoboxes, including using variables such as `var(--color-accent)` if you want something more dynamic.
