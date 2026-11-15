# Adding Mixamo characters and animations (optional)

> **Current state:** the game's people come from Quaternius' CC0 *Ultimate Modular Men/Women* packs (`npm run build:quaternius`, see `CLAUDE.md`). This guide is the optional route to more realistic people later. Mixamo uses a different skeleton (`mixamorig*` bones) and its own animation set, so its output goes to `public/assets/characters/mixamo/` and needs a small loader change before the game uses it (a second roster in `player/characterLibrary.ts`, plus Mixamo bone names in `player/character.ts`'s upper-body split, hand bone and clip names).

[Mixamo](https://www.mixamo.com) is Adobe's free library of rigged characters and animations. Every Mixamo character shares the same skeleton, so one set of animations drives everyone.

Mixamo needs a free Adobe account and can't be reached from the build environment, so the downloading is done by hand (about 20–30 minutes). Everything after that — converting, shrinking, wiring into the game — is automated.

**Licence:** Mixamo characters and animations are free to use in games (royalty-free), but they aren't open-licence assets: don't redistribute them as an asset pack.

---

## 1. Characters (aim for 8–12)

On the **Characters** tab, pick people who look different from each other: a mix of ages, genders, skin tones, body types and outfits (casual, business, workers, older people). Avoid fantasy/monster/armoured characters so the street looks like a real city. Also choose three that suit the mission givers:

| Mission giver | Suggested look |
|---|---|
| Marco (courier jobs) | casual / streetwear |
| Vera (wreck-a-car jobs) | sharp, business or leather jacket |
| Captain Reyes (helicopter) | uniform, pilot or worker look |

For each character click **Download** with:

| Setting | Value |
|---|---|
| Format | **FBX Binary (.fbx)** |
| Pose | **T-pose** |

Rename each file `char_<name>.fbx`, all lowercase, no spaces — e.g. `char_maria.fbx`, `char_old_ben.fbx`, `char_marco.fbx`, `char_vera.fbx`, `char_reyes.fbx`. The name becomes the character's name in the picker ("char_old_ben" → "Old Ben"). Use the givers' names for their three files so the game can find them.

## 2. Animations

First select **any one** of your characters (animations are downloaded *without* the character, but Mixamo needs one selected to preview). Then on the **Animations** tab search for each animation below, pick the version that looks best, and download with:

| Setting | Value |
|---|---|
| Format | **FBX Binary (.fbx)** |
| Skin | **Without Skin** |
| Frames per second | **30** |
| Keyframe reduction | none |
| **In Place** (only shown for moving animations) | **ticked** — the game moves the character itself |

Save each file with the exact name in the first column.

| File name | Search Mixamo for | Used for | Needed? |
|---|---|---|---|
| `idle.fbx` | "Breathing Idle" or "Idle" | standing | **required** |
| `walk.fbx` | "Walking" | walking | **required** |
| `run.fbx` | "Running" | running | **required** |
| `fall.fbx` | "Falling Idle" | jumping / falling | recommended |
| `punch.fbx` | "Punching" or "Cross Punch" | fists | recommended |
| `bat_swing.fbx` | "Standing Melee Attack Horizontal" | bat | recommended |
| `pistol_idle.fbx` | "Pistol Idle" | aiming a pistol (upper body) | recommended |
| `pistol_shoot.fbx` | "Shooting" (pistol) | firing a pistol | recommended |
| `rifle_idle.fbx` | "Rifle Aiming Idle" | aiming a rifle (upper body) | recommended |
| `rifle_shoot.fbx` | "Firing Rifle" | firing a rifle | recommended |
| `hit.fbx` | "Hit Reaction" | getting hit | recommended |
| `knockdown.fbx` | "Falling Back Death" or "Knocked Out" | knocked out | recommended |
| `get_up.fbx` | "Getting Up" | recovering | optional |
| `talk.fbx` | "Talking" | chats, mission givers | recommended |
| `wave.fbx` | "Waving" | mission givers | optional |
| `scared_run.fbx` | a frightened run, e.g. "Terrified" / "Run Away" (In Place) | fleeing pedestrians | optional |

Anything optional you skip falls back to a sensible alternative (e.g. fleeing uses `run`).

## 3. Upload to the repository

1. On your computer make this folder structure and put the files in it:
   ```
   art/
     mixamo/
       characters/   ← all the char_*.fbx files
       animations/   ← all the animation .fbx files
   ```
2. On GitHub open the repository, make sure the **main** branch is selected, click **Add file → Upload files**, and drag the whole `art` folder onto the page (Chrome and Edge keep the folder structure). Commit.
   - GitHub's web upload accepts files up to 25 MB and 100 files per upload. Mixamo files are normally well under that; if a character is bigger, pick a different one.

## 4. Converting (done for you)

`npm run build:characters` (in `scripts/build-characters.mjs`) turns the FBX files into small web files in `public/assets/characters/mixamo/`:

- each character → `<name>.glb`, textures resized to 1024 px WebP and the mesh compressed (typically 5–20 MB of FBX → ~1–2 MB);
- all animations → one shared `animations.glb`;
- `manifest.json` listing the characters, their heights and the clips.

The raw `art/` files aren't needed by the game once converted and can be removed from the branch.
