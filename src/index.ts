import axios from 'axios';
import express from 'express';
import { ChatCompletionRequestMessage, Configuration, OpenAIApi } from 'openai';
import { Queue } from 'queue-typescript';

import { delay } from './util';

interface InboundMessage {
  sender: string;
  recipient: string;
  body: string;
}

const openaiConfiguration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY
});
const openai = new OpenAIApi(openaiConfiguration);

const MESSAGE_HISTORY_CAP = 25;
const RESPONSE_DELAY = 5000; // in ms
const REACT_STRINGS = [
  'Laughed at',
  'Loved',
  'Liked',
  'Disliked',
  'Emphasized',
  'Questioned'
] as const;

if (!process.env.HANDLES) {
  throw Error('Missing HANDLES environment variable');
}

const HANDLES = process.env.HANDLES.split(', ');

const messageHistory: Map<
  string,
  Queue<ChatCompletionRequestMessage>
> = new Map();
const messageTimers: Map<string, NodeJS.Timeout> = new Map();

/**
 * Sends iMessage text-only messages with Jared. Jared also allows you to attach things
 * but I'm too lazy to implement that
 * @param message the message to send
 * @param recipientId handle of the recipient (as determined by iMessage db)
 */
async function sendMessage(message: string, recipientId: string) {
  const messageSet = message.split('.');
  for (const rawMessage of messageSet) {
    if (rawMessage) {
      const message = `${rawMessage.trim()}`;
      // const message = `AI: ${rawMessage.trim()}`;
      const response = await axios.post('http://localhost:3000/message', {
        body: { message },
        recipient: { handle: recipientId }
      });
      console.log(response.data);
    }
  }
}

/**
 * Pings GPT API to receive response with custom parameters tuned for text messaging.
 * @param message message for GPT to respond to
 * @returns GPT response
 */

//     'davinci:ft-personal-2022-10-02-20-52-40',
async function getGptResponse(
  messageHistoryQueue: Queue<ChatCompletionRequestMessage>
) {
  const messages = messageHistoryQueue.toArray();
  const response = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo',
    messages: [
      ...messages,
      {
        role: 'system',
        content:
          "you're texting your friends. your name is Jason, you go to stanford for computer science (human-computer interaction), and this summer you are working at a startup at y combinator. you are laid back and like to run, make videos, take photos, and build cool projects. you text casually (all lower case, short phrases, but really nice. generally, prefer asking the other person about their life, rather than talking about yourself). respond to the following text thread as jason would, or don't reply if a reply seems unnecessary (the conversation ended)."
      }
    ]
  });
  if (response.data.choices === undefined) {
    console.log('*****AI response is empty*****'); // todo probably rare
  }
  return response.data.choices[0].message; // array of strings
}

/**
 * Fetches message history associated with particular user
 * from map of message histories, or initializes a new one
 * @param sender person who sent the message
 * @returns queue of previous messages
 */
function getMessageHistory(sender: string) {
  let senderMessageHistory = messageHistory.get(sender);
  if (!senderMessageHistory) {
    senderMessageHistory = new Queue();
    messageHistory.set(sender, senderMessageHistory);
  }
  return senderMessageHistory;
}

/**
 * Prompts GPT with relevant message (especially formatting to optimize result) and
 * prints the response. Waits for rapid successive responses from same user
 * to maximize prompt quality (implemented by Scott, a consummate G 😎😎😎). Dequeues
 * from senderMessageHistory queue if it's full to reduce tokens spent on GPT.
 * @param sender person who sent the message
 */
async function handleResponseCycle(sender: string) {
  const senderMessageHistory = getMessageHistory(sender);
  const response = await getGptResponse(senderMessageHistory);
  if (!response) return;
  const text = response.content;
  senderMessageHistory.enqueue(response);

  await delay(3000);
  console.log(
    '[bold]Message history:[/bold]\n',
    Array.from(senderMessageHistory).join('\n')
  );
  if (!text || text === ' ') {
    console.log('*****AI response is empty*****'); // idk if still needed
  } else {
    sendMessage(text, sender);
  }

  while (senderMessageHistory.length > MESSAGE_HISTORY_CAP) {
    senderMessageHistory.dequeue();
  }
}

/**
 * Indicates whether received message is not worth responding to (i.e.
 * a reaction, only an image, etc.)
 * @param message message to respond to
 * @returns true if message is valid prompt, false otherwise
 */
function shouldShutup(message: InboundMessage) {
  for (let i = 0; i < REACT_STRINGS.length; i++) {
    if (message.body.startsWith(REACT_STRINGS[i])) {
      console.log('Reaction detected. [italic]Skipped![/italic]');
      return true;
    }
  }
  if (message.body == '\ufffc') {
    // this line of code is a certified Scott classic 🫡
    console.log('Only image detected. [italic]Skipped![/italic]');
    return true;
  }
  return false;
}

const app = express();
app.use(express.json());

app.post('/webhook', (req, res) => {
  console.log('===== Messaging detected ======');

  if ('participants' in req.body.recipient) {
    console.log('---- Group chat detected ---- ');
    return res.send('Webhook received and ignored for group chat');
  }

  const message: InboundMessage = {
    sender: req.body.sender.handle,
    recipient: req.body.recipient.handle,
    body: req.body.body.message
  };

  if (req.body.sender.isMe) {
    console.log('---- Message from self ----');
    return res.send('Webhook received and ignored for self sent message');
  }

  if (
    HANDLES.includes(message.sender) &&
    HANDLES.includes(message.recipient) &&
    message.body.includes('AI: ')
  ) {
    console.log('---- Message from AI to self ----');
    return res.send('Webhook received and ignored for AI message to itself');
  }

  if (shouldShutup(message)) {
    return res.send("Webhook received and ignored lol (cuz it's a reaction)");
  }

  console.log('---- 1 on 1 response ----');
  console.log(req.body);
  const senderMessageHistory = getMessageHistory(message.sender);
  senderMessageHistory.enqueue({ role: 'user', content: message.body });
  // scott's very nice timing code that i don't understand yet but will soon
  const timer = messageTimers.get(message.sender);
  if (timer) {
    console.log('Clear timeout');
    clearTimeout(timer); // todo understand this
  }
  messageTimers.set(
    message.sender,
    setTimeout(() => handleResponseCycle(message.sender), RESPONSE_DELAY)
  );
  return res.send('Webhook received!');
});

console.log('***Starting server***');
app.listen(3001);
