require('dotenv').config()
const client = require('./my_modules/DiscordJsBotClient')
var latinize = require('latinize');
const antiIPLogger = require("anti-ip-logger")
const throttler = require('./my_modules/throttler')
const settings = require("./settings")
const fs = require("fs")
const path = require("path")
const commands = require('./commands/handler')
const TextHasWords = require('./my_modules/texthaswords')
const CleanRespond = require('./my_modules/cleanrespond')
const AIChatResponse = require('./my_modules/aichatresponse')
const AntiSpam = require('./my_modules/antispam')
const isInvite = require('./my_modules/isinvite')
const LogChannel = require("./my_modules/logchannel")
require('./wrappers/permissions')

// A pretty useful method to create a delay without blocking the whole script.
const wait = require('util').promisify(setTimeout);

// Initialize the invite cache
const invites = {};


client.on('ready', async () => {
	// "ready" isn't really ready. We need to wait a spell.
	wait(1000);

	console.log(`Logged in as ${client.user.tag} and serving ${client.guilds.cache.size} guild(s)`);

	if(settings.status) client.user.setActivity(settings.status, {type: "PLAYING"})
	
	//Check every 30 minutes
	setInterval(async function(){
		var mutes = JSON.parse(fs.readFileSync(path.resolve(__dirname, "./flatdbs/mutes.json"), {encoding: "utf8", flag: "a+"}) || "{}")
		let guild = client.guilds.cache.get(process.env.GUILDID)
		if(!guild) throw new Error("This bot is not in the guildID specified by .env.")

		for(userID in mutes){
			if(mutes[userID].expires !== null && mutes[userID].expires < Date.now()){
				let target = await guild.members.fetch(userID).catch(()=>{})

				//Don't attempt to remove the role if they're not in the server.
				//The role would be gone anyways
				if(target){
					var mutedRole = guild.roles.cache.find(role => role.name.toLowerCase() === "muted")
					await target.roles.remove(mutedRole)
				}

				//Remove the log from the database
				delete mutes[userID]
			}
		}

		fs.writeFileSync(path.resolve(__dirname, "./flatdbs/mutes.json"), JSON.stringify(mutes))
	}, 1000 * 60 * 30)

	// Load all invites for all guilds and save them to the cache.
	settings.trackInvites && client.guilds.cache.forEach(g => {
		g.fetchInvites().then(guildInvites => {
		  invites[g.id] = guildInvites;
		});
	});
});

//Called when someone joins the server
client.on("guildMemberAdd", async (member) => {
	//Ban if their name has a banned phrase
	var bannedStrings = settings.bannedNameContainment
	for(var i=0; i<bannedStrings.length; i++){
		if(latinize(member.displayName.toLowerCase()).indexOf(bannedStrings[i]) !== -1){
			await member.user.send("Your name contains a banned word, thus you have been banned. Sorry for the inconvenience! We just have measures in place to prevent imposters from sending viruses via direct messages.")
			.catch(error => {})

			member.ban({reason: "Detected imposter", days: 1})

			break;
		}
	}

	//Check the database if this member is muted in this guild
	if(settings.antiMuteBypass){
		//Checks if there is a log mentioning they were muted
		let isMuted = (JSON.parse(fs.readFileSync(path.resolve(__dirname, "./flatdbs/mutes.json"), {encoding: "utf8", flag: "a+"}) || "{}"))[member.user.id]
		if(isMuted){
			//Fetch the "muted" role
			var mutedRole = member.guild.roles.cache.find(role => role.name.toLowerCase() === "muted")
			//Applies the role if it exists
			if(mutedRole) {
				await member.roles.add(mutedRole.id)

				//Tell them
				member.user.send(`You were muted in ${member.guild.name} before you left the guild, so the mute role has been re-applied`)
				.catch(error => {})
			}
		}
	}

	//Sends the welcome message if specified
	if(settings.welcomeMessage) member.user.send(settings.welcomeMessage).catch(error => {})

	//Track what invite they used by seeing which invite has incremented
	settings.trackInvites && member.guild.fetchInvites().then(guildInvites => {
		// This is the *existing* invites for the guild.
		const ei = invites[member.guild.id];
		// Update the cached invites for the guild.
		invites[member.guild.id] = guildInvites;
		// Look through the invites, find the one for which the uses went up.
		const invite = guildInvites.find(i => ei.get(i.code).uses < i.uses);
		//Logs the invite info
		LogChannel(member.guild, {embed: {
			author: {
				name: `New Member: ${member.user.tag}`,
				icon_url: member.user.avatarURL() || "https://discordapp.com/assets/322c936a8c8be1b803cd94861bdfa868.png",
			},
			fields: [
				{
					name: "Member ID",
					value: member.user.id,
					inline: true
				},
				{
					name: "Invite Code",
					value: invite.code,
					inline: true
				},
				{
					name: "Invited By",
					value: `<@${invite.inviter.id}>`,
					inline: true
				},
				{
					name: "Invite uses",
					value: invite.uses,
					inline: true
				}
			]
		}})
	});
});

client.on('message', async msg => {
	//Don't handle messages from bots
	if(msg.author.bot) return
	//Only handle messages in guild text channels
	if(msg.channel.type !== "text") return

	//Throttle message handling per guild to prevent the bot from going unresponsive due to stress
	if(settings.throttleMessages){
		var _throttler = await throttler(msg.guild.id, settings.throttleMessagesOptions)
		//Activates #TextChannel slow mode
		if(_throttler.exceedCount >= 1 && msg.channel.rateLimitPerUser < 5){
			msg.channel.setRateLimitPerUser(5, "Bot throttling due to stress. Slow mode activated to prevent excessive throttling, otherwise moderator command's latency render commands useless.")
			.catch(() => {})
		} 
	}

	try{
		//Anti-spam/raid handling (If enabled)
		if(settings.antispam) AntiSpam(msg)

		//Deletes Discord server invite links (If enabled)
		if(settings.antiinvite && isInvite(msg.content)) return msg.delete({reason: "Discord server invite link found."})

		//Deletes IP loggers (If enabled)
		if(settings.antiIPLog && await antiIPLogger(msg.content)) return msg.delete({reason: "IP logger domain found."})

		//Command parsing is initiated with ! at the beginning of the chat
		if (msg.content.substring(0,1) === settings.prefix) await commands.HandleCommand(msg, settings)
		//Trigger the chatbot if the message starts off with the bot being mentioned (If enabled) (Premium)
		else if(settings.chatbot && msg.content.indexOf(`<@!${client.user.id}>`) === 0){
			msg.channel.startTyping()
			let response = await AIChatResponse(msg.content)
			msg.channel.stopTyping()
			msg.reply(response)
		}
		//Check for defined key words and auto respond (If enabled) (Premium)
		else if(settings.autoResponder){
			var responders = settings.autoResponders
			/*Even though its turned on, they might not have actually created 
			any checkers, so check */
			if(responders) {
				for(var i=0; i<responders.checkers.length; i++){ //Goes through each checker
					if(TextHasWords(msg.content, responders.checkers[i])){
						var text = responders.responses[i]
						responders.dmPreferreds[i] ? CleanRespond(msg, text) : msg.reply(text)
					}
				}
			}
		}
	} catch(e){
		if(typeof e === "object" && 'safe' in e) msg.reply(e.safe);
		else if (typeof e === "string") msg.reply(e)
		else console.error(e) // Possibly a server error...
	}
});

//Emitted when a message is deleted
client.on("messageDelete", async msg => {
	//Don't handle messages from bots
	if(msg.author.bot) return
	//Only handle messages in text channels
	if(msg.channel.type !== "text") return

	//Logs only if enabled
	if(!settings.logMessages) return

	//Logs the deleted message
	LogChannel(msg.guild, {embed: {
		author: {
			name: `Message From ${msg.author.tag} Deleted`,
			icon_url: msg.author.avatarURL() || "https://discordapp.com/assets/322c936a8c8be1b803cd94861bdfa868.png",
		},
		fields: [
			{
				name: "Message",
				value: msg.content.substr(0,500) + (msg.content.length > 500 ? "..." : "")
			},
			{
				name: "Channel",
				value: `<#${msg.channel.id}>`
			}
		]
	}})
})

//Emitted when a message is updated
client.on("messageUpdate", async (oldMsg, newMsg) => {
	//Don't handle messages from bots
	if (oldMsg.author.bot) return
	//Only handle messages in text channels
	if(oldMsg.channel.type !== "text") return

	//Logs only if enabled
	if(!settings.logMessages) return

	//Don't log if the edited message is the same (Idk how it happens, but it does)
	if(oldMsg.content === newMsg.content) return

	//Logs the deleted message
	LogChannel(newMsg.guild, {embed: {
		author: {
			name: `${oldMsg.author.tag} Edited A Message`,
			icon_url: oldMsg.author.avatarURL() || "https://discordapp.com/assets/322c936a8c8be1b803cd94861bdfa868.png",
		},
		fields: [
			{
				name: "Old Message",
				value: oldMsg.content.substr(0,500) + (oldMsg.content.length > 500 ? "..." : "")
			},
			{
				name: "New Message",
				value: newMsg.content.substr(0,500) + (newMsg.content.length > 500 ? "..." : ""),
				inline: true
			},
			{
				name: "Message Link & Channel",
				value: `[${oldMsg.channel.name}](${oldMsg.url})`,
			}
		]
	}})
})

client.on("error", e => {
	//Discord probably went down
	//Retries logging in after a minute
	setTimeout(function(){
		client.destroy()
		client.login(process.env.BOT_TOKEN);
	}, 1000 * 60)
})

client.login(process.env.BOT_TOKEN);