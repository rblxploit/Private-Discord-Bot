# Private-Discord-Bot
Discord bot designed for use in a single server. No database software required! Just download the project, setup the .env and settings file, then run index.js.
This was designed for use with in only one guild.

# Setup

## Install

```
npm install
``

## Environment variables

Create a file named ".env" in the project's root directory

Edit it with the following content, but edit it appropriately

```
NODE_ENV=production
BOT_TOKEN=
guildID=
```

## Settings

Clone the file named "settings.default.js"
Rename the clone to "settings.js"
Edit settings.js to configure the bot. When you edit the settings, you will need to restart the bot