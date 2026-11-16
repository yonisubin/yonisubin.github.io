import type { CharacterSpec, Cond, MissionSpec, PhoneSpec, PropSpec, StoryState } from './types';

// "Kane County": the story. Data only — the director (story/director.ts) runs it.
//
// You step off a bus with nothing but your cousin Rico’s number. Rico fixes cars and owes
// money to the wrong man: Victor Kane, the developer buying up the county one "friendly"
// visit at a time. Dolores, who runs the diner and half the neighbourhood, takes you under
// her wing; Jules drives getaways and wants out; Hank won’t sell his farm; Detective Nina
// Park has had her eye on all of you since the first car you took.
//
//   Prologue  P1 Off the Bus · P2 Test Drive · P3 Pocket Money
//   Act 1     1 Repo Man · 2 The Lunch Rush · 3 Bad Paint · 4 Two-Tone’s Ride
//   Act 2     5 A Job Interview · 6 Friendly Advice (choice) · 7 Smash and Dash · 8 Lake Drop (choice)
//   Act 3     9 Missing Cousin · 10 Tail Job · 11 Ledger · 12 Hold the Line (only if you warned Hank)
//   Finale    13 Kane Falls (choice: the ending)
//
// Violence stays light, as everywhere in the game: people get knocked out, nobody dies.

// --- Conditions -------------------------------------------------------------------------

const done = (id: string): Cond => (s) => s.done.has(id);
const not = (c: Cond): Cond => (s) => !c(s);
const all = (...cs: Cond[]): Cond => (s) => cs.every((c) => c(s));
const any = (...cs: Cond[]): Cond => (s) => cs.some((c) => c(s));
const flag = (key: string, value: string | boolean = true): Cond => (s) => s.flags[key] === value;

/** Exported for the story world and tests: the state helpers the script uses. */
export const conditions = { done, not, all, any, flag };

// --- The cast ---------------------------------------------------------------------------

export const CHARACTERS: CharacterSpec[] = [
  {
    id: 'rico',
    name: 'Rico',
    color: '#ff9f43',
    look: { id: 'm_worker', skin: 2, hair: 1, outfit: 3, height: 1.78 },
    // Hiding at the lake once he’s sold you out (Act 3), back at the garage for the end.
    spots: [{ at: 'lakeHide', when: all(done('m8'), done('m6'), not(done('m11'))) }, { at: 'garage' }],
  },
  {
    id: 'dolores',
    name: 'Dolores',
    color: '#ff6b9a',
    look: { id: 'w_formal', skin: 3, hair: 5, outfit: 2, height: 1.62 },
    spots: [{ at: 'diner', when: done('p2') }],
  },
  {
    id: 'kane',
    name: 'Victor Kane',
    color: '#c9b37e',
    look: { id: 'm_suit', skin: 0, hair: 3, outfit: 0, height: 1.88 },
    spots: [{ at: 'kane', when: all(done('m4'), not(done('m13'))) }],
  },
  {
    id: 'tommy',
    name: 'Tommy "Two-Tone"',
    color: '#9b8cff',
    look: { id: 'm_punk', skin: 4, hair: 0, outfit: 3, height: 1.9 },
    spots: [{ at: 'motel', when: all(done('m2'), not(done('m4'))) }],
  },
  {
    id: 'jules',
    name: 'Jules',
    color: '#4ecdc4',
    look: { id: 'w_casual', skin: 4, hair: 4, outfit: 1, height: 1.7 },
    spots: [{ at: 'shack', when: all(done('m5'), not(flag('jules', 'quit'))) }],
  },
  {
    id: 'hank',
    name: 'Hank',
    color: '#a3d977',
    look: { id: 'm_farmer', skin: 1, hair: 5, outfit: 0, height: 1.84 },
    // If you scared him off his land, he’s gone.
    spots: [{ at: 'farm', when: all(done('m5'), not(flag('hank', 'scared'))) }],
  },
  {
    id: 'nina',
    name: 'Det. Nina Park',
    color: '#5aa9ff',
    look: { id: 'w_suit', skin: 2, hair: 0, outfit: 0, height: 1.72 },
    spots: [{ at: 'diner', when: done('m11') }, { at: 'police', when: done('m9') }],
  },
];

// --- The missions -----------------------------------------------------------------------

export const MISSIONS: MissionSpec[] = [
  // ======================================================================== PROLOGUE
  {
    id: 'p1',
    title: 'Off the Bus',
    act: 'Prologue',
    giver: null,
    requires: [],
    summary: 'Find your cousin Rico.',
    reward: 50,
    steps: [
      { kind: 'wait', seconds: 1.5, text: 'The bus pulls away…' },
      {
        kind: 'phone',
        message: {
          from: 'rico',
          lines: ['Cuz! You made it. Garage is a few blocks from the bus stop — I put a pin on your map.', "Walk, don’t run. You’re not famous yet."],
        },
      },
      { kind: 'goto', to: 'garage', text: "Walk to Rico’s garage (follow the pink line)", by: 'foot' },
      {
        kind: 'scene',
        with: 'rico',
        lines: [
          { who: 'rico', text: 'Look at you! Last time I saw you, you were stealing my bike.' },
          { who: 'you', text: 'Borrowing. I gave it back.' },
          { who: 'rico', text: 'In two pieces. Welcome to Kane County. Welcome to Vance Auto.' },
          { who: 'you', text: "Vance Auto. It’s… a garage." },
          { who: 'rico', text: "It’s a business. Mostly. Business is slow, so you’re going to help me speed it up." },
          { who: 'rico', text: "Here’s fifty bucks. Don’t spend it on anything I wouldn’t spend it on." },
        ],
      },
    ],
    after: [{ from: 'rico', lines: ['Come find me at the garage when you’re ready. Got a little job.'], delay: 4 }],
  },
  {
    id: 'p2',
    title: 'Test Drive',
    act: 'Prologue',
    giver: 'rico',
    requires: ['p1'],
    summary: "Return a customer’s car without a scratch.",
    reward: 100,
    steps: [
      {
        kind: 'scene',
        with: 'rico',
        lines: [
          { who: 'rico', text: "Mrs. Alvarez’s sedan. Fixed the brakes. Mostly fixed the brakes." },
          { who: 'you', text: 'Mostly?' },
          { who: 'rico', text: "Drive it to her house. Gently. She tips in cookies, and I’m hungry." },
          { who: 'rico', text: 'Any car out front will do, honestly. She can’t tell them apart.' },
        ],
      },
      { kind: 'enter', vehicle: 'car', text: 'Get in a car (E to get in)' },
      { kind: 'drive', to: 'customer', text: "Drive to Mrs. Alvarez’s house — no crashes", maxCrashes: 0 },
      { kind: 'goto', to: 'garage', text: 'Head back to the garage' },
      {
        kind: 'scene',
        with: 'rico',
        lines: [
          { who: 'rico', text: 'Not a scratch? Who taught you to drive?' },
          { who: 'you', text: 'You did.' },
          { who: 'rico', text: "Then I’m a genius. Go see Dolores at the diner — she said she’d feed you, and she never offers twice." },
        ],
      },
    ],
  },
  {
    id: 'p3',
    title: 'Pocket Money',
    act: 'Prologue',
    giver: 'dolores',
    requires: ['p2'],
    summary: 'Earn a fare, buy something to protect yourself.',
    reward: 150,
    steps: [
      {
        kind: 'scene',
        with: 'dolores',
        lines: [
          { who: 'dolores', text: "So you’re Rico’s cousin. You have his eyes. Hopefully not his luck." },
          { who: 'you', text: 'He said you’d feed me.' },
          { who: 'dolores', text: 'I feed people who work. Take a taxi out, do one fare, bring me the money.' },
          { who: 'dolores', text: "And buy yourself a bat. This town has two kinds of people. Ones with bats, and ones who wish they had one." },
        ],
      },
      { kind: 'enter', vehicle: 'taxi', text: 'Find a taxi (the yellow car)' },
      { kind: 'fare', text: 'Press J (JOB) and complete one taxi fare' },
      { kind: 'buy', weapon: 'bat', text: 'Buy a bat at Guns & Ammo ($ on the map)' },
      { kind: 'goto', to: 'diner', text: "Back to Dolores’s diner" },
      {
        kind: 'scene',
        with: 'dolores',
        lines: [
          { who: 'dolores', text: 'A fare and a bat. You learn fast.' },
          { who: 'dolores', text: 'Keep the money. Eat something. And listen to me: whatever Rico is into, you don’t have to be.' },
          { who: 'you', text: 'What is Rico into?' },
          { who: 'dolores', text: "Debt. Same as everybody in this county. Go on — he’s waiting for you." },
        ],
      },
    ],
    after: [{ from: 'rico', lines: ['Got a real job now. Pays real money. Garage.'], delay: 6 }],
  },

  // ======================================================================== ACT 1
  {
    id: 'm1',
    title: 'Repo Man',
    act: 'Act 1',
    giver: 'rico',
    requires: ['p3'],
    summary: "Take back a car from a man who didn’t pay.",
    reward: 400,
    steps: [
      {
        kind: 'scene',
        with: 'rico',
        lines: [
          { who: 'rico', text: "A guy didn’t pay for his repairs. So the car he’s driving is technically… mine." },
          { who: 'you', text: 'Technically.' },
          { who: 'rico', text: "I’ve marked it. Take it, lose anyone who gets excited, bring it here." },
          { who: 'rico', text: "You’ll need that bat out. People are attached to their cars." },
        ],
      },
      { kind: 'markCar', car: 'repo', min: 120, max: 260 },
      { kind: 'jack', car: 'repo', text: 'Carjack the marked car (weapon out, E when it’s slow)' },
      { kind: 'loseCops', text: 'Lose the police' },
      { kind: 'drive', to: 'garage', text: 'Bring the car to the garage' },
      {
        kind: 'scene',
        with: 'rico',
        lines: [
          { who: 'rico', text: 'That’s the one! Beautiful. I mean — terrible what people do with their debts.' },
          { who: 'rico', text: 'Here. Your cut. Don’t tell Dolores where it came from.' },
          { who: 'you', text: 'She’ll know.' },
          { who: 'rico', text: 'She always knows.' },
        ],
      },
    ],
    after: [
      { from: 'nina', lines: ['Nice car. Shame it isn’t yours.', '— Det. Park, Kane County PD. We’ll talk.'], delay: 8 },
    ],
  },
  {
    id: 'm2',
    title: 'The Lunch Rush',
    act: 'Act 1',
    giver: 'dolores',
    requires: ['p3'],
    summary: 'Deliver lunch orders around downtown before they go cold.',
    reward: 350,
    steps: [
      {
        kind: 'scene',
        with: 'dolores',
        lines: [
          { who: 'dolores', text: 'Five orders, five offices. Some of them pay for lunch. Some of them pay for… quiet.' },
          { who: 'you', text: 'Quiet?' },
          { who: 'dolores', text: "Nobody bothers a neighbourhood that looks after itself. Go — and don’t let the soup go cold." },
        ],
      },
      { kind: 'packages', around: 'diner', count: 5, time: 240, text: 'Drop off the lunch orders' },
      { kind: 'goto', to: 'diner', text: 'Back to the diner' },
      {
        kind: 'scene',
        with: 'dolores',
        lines: [
          { who: 'dolores', text: 'All five, still warm. Mr. Feld even said thank you, and he hates everybody.' },
          { who: 'dolores', text: "There’s a man called Tommy Briggs asking about Rico. Two-Tone, they call him. Keep your eyes open." },
        ],
      },
    ],
    after: [{ from: 'tommy', lines: ['You the cousin? Tell Rico his paint job is due. Kane doesn’t wait.'], delay: 10 }],
  },
  {
    id: 'm3',
    title: 'Bad Paint',
    act: 'Act 1',
    giver: 'rico',
    requires: ['m1', 'm2'],
    summary: "Kane’s thugs are wrecking the garage.",
    reward: 500,
    steps: [
      {
        kind: 'scene',
        with: 'rico',
        lines: [
          { who: 'rico', text: 'Okay. Don’t panic. Tommy’s outside with some friends.' },
          { who: 'you', text: 'How much do you owe, Rico?' },
          { who: 'rico', text: 'A number. A big round number. Kane lent me money to keep the garage, and now he wants the garage.' },
          { who: 'tommy', text: 'Vance! Kane says hello. We brought paint.' },
          { who: 'rico', text: 'That’s not paint.' },
        ],
      },
      { kind: 'goons', at: 'garage', count: 4, text: "Knock out Tommy’s thugs" },
      {
        kind: 'scene',
        with: 'rico',
        lines: [
          { who: 'tommy', text: 'This isn’t over, cousin. Kane remembers faces.' },
          { who: 'rico', text: '…Did you see that? He ran! Tommy Two-Tone ran!' },
          { who: 'you', text: 'He’ll be back.' },
          { who: 'rico', text: 'Then we’ll be ready. We. I like that. Vance and cousin.' },
        ],
      },
    ],
    after: [{ from: 'dolores', lines: ['I heard. Come see me. We should send Mr. Briggs a message.'], delay: 6 }],
  },
  {
    id: 'm4',
    title: "Two-Tone’s Ride",
    act: 'Act 1',
    giver: 'dolores',
    requires: ['m3'],
    summary: "Send Tommy a message he can’t drive away from.",
    reward: 600,
    steps: [
      {
        kind: 'scene',
        with: 'dolores',
        lines: [
          { who: 'dolores', text: "Tommy loves that car more than his mother. He’s driving it around like nothing happened." },
          { who: 'dolores', text: 'Nobody gets hurt. The car, though…' },
          { who: 'you', text: 'Is this how you keep the neighbourhood quiet?' },
          { who: 'dolores', text: 'This is how I kept it quiet for thirty years. Kane is louder than anyone I’ve met.' },
        ],
      },
      { kind: 'markCar', car: 'tommy', min: 120, max: 240 },
      { kind: 'wreck', car: 'tommy', text: "Wreck Tommy’s car (marked)", time: 180 },
      { kind: 'loseCops', text: 'Lose the police' },
      { kind: 'goto', to: 'diner', text: 'Back to the diner' },
      {
        kind: 'scene',
        with: 'dolores',
        lines: [
          { who: 'dolores', text: 'Rico put up a new sign. “Vance & Cousin.” Ugly, but he’s proud of it.' },
          { who: 'dolores', text: 'And I’ve had a word with the gun shops. Friends of mine get a discount.' },
          { who: 'you', text: 'Am I a friend of yours?' },
          { who: 'dolores', text: 'You are now. Which means Kane knows your name too. Be careful.' },
        ],
      },
    ],
    after: [
      {
        from: 'kane',
        call: true,
        delay: 10,
        lines: [
          'Hello. Victor Kane. You’ve been redecorating my associate’s car.',
          'I admire initiative. I could use a driver with nerve.',
          'Kane Holdings. Come and see me — I’ll make it worth your while.',
        ],
      },
    ],
  },

  // ======================================================================== ACT 2
  {
    id: 'm5',
    title: 'A Job Interview',
    act: 'Act 2',
    giver: 'kane',
    requires: ['m4'],
    summary: "Drive Victor Kane to his meeting. Don’t scuff the suit.",
    reward: 800,
    steps: [
      {
        kind: 'scene',
        with: 'kane',
        lines: [
          { who: 'kane', text: 'The famous cousin. Sit, sit. Tommy speaks very highly of your… swing.' },
          { who: 'you', text: 'Rico owes you money.' },
          { who: 'kane', text: 'Rico owes everybody money. You, on the other hand, could make some.' },
          { who: 'kane', text: 'I have a meeting at the bank. Drive me. Smoothly. I’m told I bruise like a peach.' },
        ],
      },
      { kind: 'enter', vehicle: 'car', text: 'Get a car for Mr. Kane' },
      { kind: 'drive', to: 'bank', text: 'Drive Kane to the bank — two crashes and he walks', maxCrashes: 2, time: 260 },
      {
        kind: 'scene',
        with: 'kane',
        lines: [
          { who: 'kane', text: 'Adequate. More than adequate. You and I are going to get along.' },
          { who: 'kane', text: 'Go and meet a friend of mine at Seaside — Jules. She has work for someone with steady hands.' },
          { who: 'you', text: 'And Rico’s debt?' },
          { who: 'kane', text: 'Debts are just promises with numbers on them. Keep yours, and I’ll forget his.' },
        ],
      },
    ],
    after: [{ from: 'jules', lines: ['Kane says you can drive. I’ll be the judge of that. Shack by the beach.'], delay: 8 }],
  },
  {
    id: 'm6',
    title: 'Friendly Advice',
    act: 'Act 2',
    giver: 'kane',
    requires: ['m5'],
    summary: "Talk to a farmer who won’t sell his land.",
    reward: 600,
    steps: [
      {
        kind: 'scene',
        with: 'kane',
        lines: [
          { who: 'kane', text: 'There’s a farmer in Eastfield. Hank. Lovely man. Sitting on the land for my new outlet mall.' },
          { who: 'kane', text: 'Go and give him some friendly advice. You know the kind.' },
        ],
      },
      { kind: 'drive', to: 'farm', text: "Drive out to Hank’s farm in Eastfield" },
      {
        kind: 'scene',
        with: 'hank',
        lines: [
          { who: 'hank', text: 'Another one of Kane’s errand boys. Last one broke my mailbox.' },
          { who: 'hank', text: 'My grandfather cleared this field. I’m not selling it so a man in a nice suit can put a parking lot on it.' },
          { who: 'you', text: '…' },
        ],
        choice: [
          {
            label: 'Scare him: “Sell, Hank. Or Kane’s boys come back.”',
            set: { hank: 'scared' },
            reply: [
              { who: 'hank', text: '…Fine. FINE. He can have it. I hope he chokes on the corn.' },
              { who: 'you', text: 'Sorry, Hank.' },
            ],
          },
          {
            label: 'Warn him: “Kane’s coming for your land. Be ready.”',
            set: { hank: 'warned' },
            reply: [
              { who: 'hank', text: 'You’re… warning me? You work for him.' },
              { who: 'you', text: 'I drive for him. That’s not the same thing.' },
              { who: 'hank', text: 'Then I’ll be ready. And I won’t forget this.' },
            ],
          },
        ],
      },
    ],
    after: [
      { from: 'kane', lines: ['Hank is packing. Excellent work. You have a future.'], delay: 6, when: flag('hank', 'scared') },
      { from: 'hank', lines: ['Fixed the mailbox. Bought a bigger shotgun. Kidding. Mostly. Thank you.'], delay: 8, when: flag('hank', 'warned') },
    ],
  },
  {
    id: 'm7',
    title: 'Smash and Dash',
    act: 'Act 2',
    giver: 'jules',
    requires: ['m5'],
    summary: "Kane’s job: drive the getaway from the bank.",
    reward: 1500,
    steps: [
      {
        kind: 'scene',
        with: 'jules',
        lines: [
          { who: 'jules', text: 'So you’re the new driver. You look like you’ve never outrun anything.' },
          { who: 'you', text: 'I outran a bus this morning.' },
          { who: 'jules', text: 'Cute. Kane wants a bank courier’s bag. The crew grabs it, you drive. Through the gates, to the pier, lose the cops.' },
          { who: 'jules', text: "I’d drive it myself, but my kid has a recital, and I promised I’d be there in one piece." },
        ],
      },
      { kind: 'drive', to: 'bank', text: 'Get a car and pick up the crew at the bank' },
      { kind: 'stars', stars: 3 },
      { kind: 'gates', from: 'bank', to: 'pier', time: 170, text: 'Getaway! Through the gates to the pier' },
      { kind: 'loseCops', text: 'Lose the police' },
      { kind: 'goto', to: 'shack', text: "Back to Jules’s shack" },
      {
        kind: 'scene',
        with: 'jules',
        lines: [
          { who: 'jules', text: 'Huh. You can drive.' },
          { who: 'jules', text: 'Funny thing — the bag was full of Kane’s own money. He robbed himself. Insurance, I bet.' },
          { who: 'you', text: 'Why would he…' },
          { who: 'jules', text: "Because someone has to take the fall for a robbery, and it isn’t going to be Victor Kane." },
        ],
      },
    ],
    after: [{ from: 'jules', lines: ['One more job. Then I think I’m done with all this. Come by.'], delay: 10 }],
  },
  {
    id: 'm8',
    title: 'Lake Drop',
    act: 'Act 2',
    giver: 'jules',
    requires: ['m7'],
    summary: "Run Kane’s bag across the lake by speedboat.",
    reward: 1200,
    steps: [
      {
        kind: 'scene',
        with: 'jules',
        lines: [
          { who: 'jules', text: 'Kane wants the bag moved across the lake. Boat’s at the dock. Follow the buoys — the shallows will eat you otherwise.' },
          { who: 'jules', text: 'Last job. I mean it this time.' },
        ],
      },
      { kind: 'goto', to: 'lakeDock', text: 'Get to the lake dock' },
      { kind: 'enter', vehicle: 'boat', text: 'Take the speedboat' },
      { kind: 'buoys', from: 'lakeDock', to: 'lakeFar', count: 5, time: 150, text: 'Steer past the buoys' },
      {
        kind: 'scene',
        lines: [
          { who: 'jules', text: '(on the phone) Drop done? Good. Kane just called. He wants me for another one. And another.' },
          { who: 'jules', text: 'My kid asked me today what I do for work. I said “driving”. She said “driving where?”' },
        ],
        choice: [
          {
            label: '“Get out, Jules. While you still can.”',
            set: { jules: 'quit' },
            reply: [
              { who: 'jules', text: '…Yeah. Yeah, I think I knew that. Gone fishing, then. For real.' },
              { who: 'jules', text: 'Thanks. Look after yourself — Kane doesn’t like it when people leave.' },
            ],
          },
          {
            label: '“Stay. I need a driver I can trust.”',
            set: { jules: 'stayed' },
            reply: [
              { who: 'jules', text: 'You trust me? That’s… new.' },
              { who: 'jules', text: 'Okay. For you. But when this is over, I’m buying a bait shop and never driving again.' },
            ],
          },
        ],
      },
    ],
    after: [{ from: 'dolores', call: true, delay: 12, lines: ['Have you seen Rico?', 'The garage is boarded up. Nobody’s answering.', 'Come to the diner. Now.'] }],
  },

  // ======================================================================== ACT 3
  {
    id: 'm9',
    title: 'Missing Cousin',
    act: 'Act 3',
    giver: 'dolores',
    requires: ['m6', 'm8'],
    summary: 'Rico has vanished. Find him.',
    reward: 500,
    steps: [
      {
        kind: 'scene',
        with: 'dolores',
        lines: [
          { who: 'dolores', text: 'He came in yesterday, white as milk. Paid his tab. Rico has never paid his tab.' },
          { who: 'dolores', text: 'Then he said, “Tell my cousin I’m sorry.” Sorry for what?' },
        ],
      },
      { kind: 'goto', to: 'garage', text: 'Check the garage' },
      {
        kind: 'scene',
        lines: [
          { who: 'you', text: 'Boarded up. A note under the door…' },
          { who: 'you', text: '“Gone where the fish don’t judge you. — R.” The lake. He always went to the lake.' },
        ],
      },
      { kind: 'goto', to: 'lakeHide', text: 'Find Rico at the lake' },
      {
        kind: 'scene',
        with: 'rico',
        lines: [
          { who: 'rico', text: 'You found me. Of course you found me. You always find me.' },
          { who: 'you', text: 'What did you do, Rico?' },
          { who: 'rico', text: 'Kane said he’d wipe my debt if I told him things. Where you sleep. Who you work with.' },
          { who: 'rico', text: 'The bank job — it was never a robbery. It’s a set-up. Kane robbed himself, and the police are going to find your face on the cameras.' },
          { who: 'you', text: 'You sold me out.' },
          { who: 'rico', text: 'I sold you out. And then I couldn’t sleep. I’m sorry. I don’t expect that to fix anything.' },
        ],
      },
      { kind: 'set', flags: { ricoConfessed: true } },
    ],
    after: [
      {
        from: 'nina',
        call: true,
        delay: 8,
        lines: ['This is Detective Park.', 'I know about the bank. I also know it wasn’t your idea.', 'Come to the station. Alone. Let’s talk about Victor Kane.'],
      },
    ],
  },
  {
    id: 'm10',
    title: 'Tail Job',
    act: 'Act 3',
    giver: 'nina',
    requires: ['m9'],
    summary: "Follow Kane’s car without being spotted.",
    reward: 800,
    steps: [
      {
        kind: 'scene',
        with: 'nina',
        lines: [
          { who: 'nina', text: 'Sit down. You’re not under arrest. Yet.' },
          { who: 'nina', text: 'Kane has half this department on his Christmas list. I can’t touch him without proof — a ledger. Names, payments, everything.' },
          { who: 'you', text: 'And you need me because…' },
          { who: 'nina', text: 'Because he trusts you, and because you don’t want to go to prison for his robbery. Follow his car. Don’t get close.' },
        ],
      },
      { kind: 'markCar', car: 'kane', min: 100, max: 220 },
      { kind: 'follow', car: 'kane', text: "Tail Kane’s car — stay 25–90 m back", min: 25, max: 90, seconds: 75 },
      {
        kind: 'scene',
        lines: [
          { who: 'nina', text: '(on the phone) He stopped at Kane Holdings and went straight up to the roof office. That’s where he keeps it.' },
          { who: 'nina', text: 'There’s no way up there on foot. Ever flown a helicopter?' },
          { who: 'you', text: 'No.' },
          { who: 'nina', text: 'Today’s a good day to learn.' },
        ],
      },
    ],
  },
  {
    id: 'm11',
    title: 'Ledger',
    act: 'Act 3',
    giver: 'nina',
    requires: ['m10'],
    summary: "Fly to Kane’s roof office and take the ledger.",
    reward: 1200,
    steps: [
      {
        kind: 'scene',
        with: 'nina',
        lines: [
          { who: 'nina', text: 'There’s a helicopter at the downtown pad. I’ve arranged for nobody to notice it’s gone for an hour.' },
          { who: 'nina', text: 'Through the approach markers, over the roof, grab the ledger. Don’t crash. I signed for that.' },
        ],
      },
      { kind: 'enter', vehicle: 'heli', text: 'Take the helicopter at the helipad' },
      { kind: 'rings', from: 'helipad', to: 'kaneRoof', count: 6, text: 'Fly through the markers to Kane’s roof', time: 240 },
      { kind: 'set', flags: { ledger: true } },
      { kind: 'goto', to: 'police', text: 'Bring the ledger to Det. Park' },
      {
        kind: 'scene',
        with: 'nina',
        lines: [
          { who: 'nina', text: 'This is it. Names, dates, amounts. Two judges, a councilman… and my lieutenant. Of course.' },
          { who: 'nina', text: 'Hold on to it until I can get a warrant past people who aren’t in here. Meet me at Dolores’s place.' },
          { who: 'nina', text: 'Rico’s there too. He wants to help. Let him.', when: flag('ricoConfessed') },
        ],
      },
    ],
    after: [
      { from: 'hank', lines: ['Trucks on the road. Kane’s people. They’re coming for the farm. Please.'], delay: 6, when: flag('hank', 'warned') },
      { from: 'kane', call: true, delay: 14, lines: ['Something of mine is missing.', 'I’m a reasonable man. Return it, and we forget this.', 'Don’t, and I stop being reasonable.'] },
    ],
  },
  {
    id: 'm12',
    title: 'Hold the Line',
    act: 'Act 3',
    giver: 'hank',
    requires: ['m9'],
    when: flag('hank', 'warned'),
    summary: "Kane’s thugs are coming for Hank’s farm.",
    reward: 900,
    steps: [
      {
        kind: 'scene',
        with: 'hank',
        lines: [
          { who: 'hank', text: 'You warned me. I got ready. Problem is, “ready” is me and a rake.' },
          { who: 'hank', text: 'Here they come. Don’t let them near the barn.' },
        ],
      },
      { kind: 'goons', at: 'farm', count: 6, text: 'Defend the farm — knock out Kane’s thugs', time: 200 },
      {
        kind: 'scene',
        with: 'hank',
        lines: [
          { who: 'hank', text: 'Ha! Look at them run. Tell Kane the corn says no.' },
          { who: 'hank', text: "I’m planting the whole field this year. All of it. Come back in summer and I’ll give you a sack." },
        ],
      },
    ],
  },

  // ======================================================================== FINALE
  {
    id: 'm13',
    title: 'Kane Falls',
    act: 'Finale',
    giver: 'nina',
    requires: ['m11'],
    when: any(done('m12'), flag('hank', 'scared')),
    summary: 'Kane is running. End it.',
    reward: 3000,
    steps: [
      {
        kind: 'scene',
        with: 'nina',
        lines: [
          { who: 'nina', text: 'He knows. He’s cleaning out his accounts and making a run for the county line.' },
          { who: 'rico', text: 'I know his car. I fixed his car. The steering pulls left — you’ll catch him on the corners.' },
          { who: 'dolores', text: 'Thirty years I kept this neighbourhood quiet. Go and make some noise.' },
          { who: 'nina', text: 'Every cop in the county is about to chase whoever is closest to Kane. That’s you. Try not to get arrested before I do it properly.' },
        ],
      },
      { kind: 'markCar', car: 'kane', min: 140, max: 260 },
      { kind: 'stars', stars: 4 },
      { kind: 'wreck', car: 'kane', text: "Stop Kane — wreck his car!", time: 200 },
      { kind: 'loseCops', text: 'Lose the police' },
      { kind: 'goto', to: 'diner', text: 'Back to the diner' },
      {
        kind: 'scene',
        with: 'nina',
        lines: [
          { who: 'nina', text: 'Kane walked away from the wreck straight into two of my officers. The honest two.' },
          { who: 'nina', text: 'Now. The ledger. With it, he goes away for a very long time — and the people he owns go with him.' },
          { who: 'kane', text: '(handcuffed, on the radio) Whatever she’s offering, I’ll double it. The ledger and you walk away rich.' },
        ],
        choice: [
          {
            label: 'Give Nina the ledger.',
            set: { ending: 'clean' },
            reply: [
              { who: 'nina', text: 'Thank you. I didn’t think you would.' },
              { who: 'dolores', text: 'Thirty years waiting for someone to do that. It had to be Rico’s cousin.' },
              { who: 'rico', text: 'Vance & Cousin. Honest repairs. Mostly honest.' },
            ],
          },
          {
            label: "Keep it. Kane’s money buys a lot of silence.",
            set: { ending: 'rich' },
            reply: [
              { who: 'nina', text: 'Then I was wrong about you. Don’t let me catch you.' },
              { who: 'kane', text: 'A pleasure doing business. Kane Holdings is under new management — yours.' },
              { who: 'dolores', text: 'I hope it’s worth it, sweetheart. It never is.' },
            ],
          },
        ],
      },
    ],
    after: [
      { from: 'rico', delay: 6, lines: ['Repainted the sign. Couldn’t have done any of it without you. Dinner’s on me. Well. On Dolores.'] },
      { from: 'jules', delay: 14, when: flag('jules', 'quit'), lines: ['Caught a fish this big. Kid says hi. Thank you for telling me to go.'] },
      { from: 'jules', delay: 14, when: flag('jules', 'stayed'), lines: ['Bait shop’s open. You stayed with me, I stay with you. Need a driver, you call.'] },
      { from: 'hank', delay: 22, when: flag('hank', 'warned'), lines: ['First green shoots in the field. Sack of corn waiting for you.'] },
      { from: 'nina', delay: 30, when: flag('ending', 'clean'), lines: ['Kane got twenty years. My lieutenant got a new job: no job. Stay out of trouble. Or at least out of my sight.'] },
      { from: 'nina', delay: 30, when: flag('ending', 'rich'), lines: ['Kane walked. Funny how that happens. I’m watching you.'] },
    ],
  },
];

/** Missions that the story counts as "the main line" (for progress and the epilogue). */
export const STORY_ORDER = MISSIONS.map((m) => m.id);

// --- The world, as the story changes it ---------------------------------------------------

export const PROPS: PropSpec[] = [
  // Rico’s garage: shabby → "Vance & Cousin" → boarded up while he hides → repainted.
  { id: 'garage-old', at: 'garage', offset: [0, 3], kind: 'sign', text: 'VANCE AUTO', colors: ['#5a5148', '#d8cbb0'], when: not(done('m4')) },
  { id: 'garage-cousin', at: 'garage', offset: [0, 3], kind: 'sign', text: 'VANCE & COUSIN', colors: ['#1f6f8b', '#ffffff'], when: all(done('m4'), not(all(done('m6'), done('m8'))), not(done('m13'))) },
  { id: 'garage-boards', at: 'garage', offset: [0, 3], kind: 'boards', when: all(done('m6'), done('m8'), not(done('m13'))) },
  { id: 'garage-new', at: 'garage', offset: [0, 3], kind: 'sign', text: 'VANCE & COUSIN · EST. TODAY', colors: ['#e8562a', '#ffffff'], when: done('m13') },
  // Dolores’s diner: dim until she trusts you.
  { id: 'diner-dim', at: 'diner', offset: [0, 3], kind: 'sign', text: 'DINER', colors: ['#3a3a3a', '#9a9a9a'], when: not(done('m2')) },
  { id: 'diner-lit', at: 'diner', offset: [0, 3], kind: 'sign', text: "DOLORES’S · OPEN", colors: ['#d63b6f', '#fff3a8'], when: done('m2') },
  // Kane Holdings: the sign, then what becomes of it.
  { id: 'kane-sign', at: 'kane', offset: [0, 4], kind: 'sign', text: 'KANE HOLDINGS', colors: ['#1c1c1e', '#c9b37e'], when: not(done('m13')) },
  { id: 'kane-tape', at: 'kane', offset: [0, 4], kind: 'banner', text: 'UNDER INVESTIGATION', colors: ['#f5d90a', '#111111'], when: flag('ending', 'clean') },
  { id: 'kane-sold', at: 'kane', offset: [0, 4], kind: 'banner', text: 'UNDER NEW MANAGEMENT', colors: ['#2a7a3b', '#ffffff'], when: flag('ending', 'rich') },
  // Hank’s farm: crops if he stayed, a "sold" sign if you scared him off.
  { id: 'farm-crops', at: 'farm', offset: [0, 14], kind: 'crops', when: all(flag('hank', 'warned'), any(done('m12'), done('m13'))) },
  { id: 'farm-sold', at: 'farm', offset: [0, 3], kind: 'sign', text: 'SOLD · KANE HOLDINGS', colors: ['#7a1f1f', '#ffffff'], when: flag('hank', 'scared') },
  // Jules’s shack.
  { id: 'shack-fishing', at: 'shack', offset: [0, 3], kind: 'sign', text: 'GONE FISHING', colors: ['#2e86ab', '#ffffff'], when: flag('jules', 'quit') },
  { id: 'shack-bait', at: 'shack', offset: [0, 3], kind: 'sign', text: "JULES’S BAIT & TACKLE", colors: ['#f4a259', '#1c1c1e'], when: all(flag('jules', 'stayed'), done('m13')) },
];

/** Gun stores give Dolores’s friends 15 % off. */
export const discount: Cond = done('m4');

/** For tests and the HUD: is this story state complete? */
export function storyFinished(s: StoryState): boolean {
  return s.done.has('m13');
}

/** Phone messages that aren’t tied to a mission (none yet; kept for later chapters). */
export const EXTRA_PHONE: PhoneSpec[] = [];
