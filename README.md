# Craft N Code Karnataka 2026

State qualifier for the Craft N Code National Hackathon at IIIT Bhubaneswar, organised by RV College of Engineering and RVITM.

## Boardroom project in this fork

This fork includes **Boardroom — Whiteboard Code Verifier**, an executable digital whiteboard for teaching C. Teachers write or type code, review Gemini handwriting transcription, and run it through GCC in Docker, with diagnostics linked back to the board.

- [Application README and setup](whiteboard-code-verifier/README.md)
- [Technical stack and project overview](whiteboard-code-verifier/docs/technical-overview.md)
- [OCR options and evaluation](whiteboard-code-verifier/docs/ocr-options.md)
- [Original project notes](whiteboard-code-verifier.md)

With Node.js 22.12+ and a working Linux Docker daemon:

```bash
cd whiteboard-code-verifier
npm ci
npm run runner:build
npm run dev
```

Open http://127.0.0.1:5173. For handwriting recognition, configure `GEMINI_API_KEY` in the app's private `.env` file; see `.env.example`. Typed code works without OCR credentials.

The original hackathon information follows.

| | |
|---|---|
| Theme | AI for Education |
| Mode | Online, 48 hours |
| Dates | 17 to 18 October 2026 |
| Submission deadline | 18 October 2026, 11:59 PM IST |
| Eligibility | Students of colleges in Karnataka |
| Registration fee | Rs. 299 per team |
| Outcome | Top teams qualify for the national finals at IIIT Bhubaneswar |

## Problem statement

Build an AI-powered solution that helps people learn or teach better.

Choose your own user and problem: a student, a teacher, an administrator, or a learner with limited access. Any technical approach is acceptable. Public datasets and synthetic data may be used.

## How to submit

Submissions are made as a pull request to this repository.

1. Fork this repository and clone your fork.
2. Create a branch named after your team. Use your team name with hyphens instead of spaces.
3. Copy `submissions/_TEMPLATE/submission.md` to `submissions/<team-name>/submission.md`.
4. Fill in your links and answers.
5. Commit and push the branch.
6. Open a pull request into `main` and complete the PR form.

```bash
git clone https://github.com/<your-username>/Craft-N-Code-Karnataka.git
cd Craft-N-Code-Karnataka
git checkout -b <team-name>
mkdir submissions/<team-name>
cp submissions/_TEMPLATE/submission.md submissions/<team-name>/submission.md
git add submissions/<team-name>
git commit -m "Submission: <team-name>"
git push -u origin <team-name>
```

A check runs on your pull request. If it fails, open its details to see what is missing, fix it, and push to the same branch. The check runs again.

You can push further commits to the same branch until the deadline. The last commit made before 11:59 PM IST on 18 October 2026 is the one that is scored.

## What to submit

| Item | Requirement |
|---|---|
| Code repository | Public GitHub link, with commits made during the hackathon. |
| Repository README | Problem and user, How it works, Data and AI used, How to run it, AI tools and reused code, Limits. |
| Demo video | About 5 minutes, 5:00 at most. Screen recording of the working solution. YouTube link, or Google Drive link with view access enabled for anyone with the link. |
| Slides | Google Slides link with view access enabled for anyone with the link. 8 slides at most. |
| Deployed URL | Optional. Link to the working platform. |
| Short answers | Three questions in `submission.md`. All three are mandatory. |

Teams are responsible for making sure the repository, video, slides and deployed URL are public and open without login. Judges will score only what they can open.

## Evaluation

Each judge scores five criteria from 1 to 5. Scores are weighted to a total of 100.

| Criterion | Points | What judges look for |
|---|---|---|
| Impact and relevance | 25 | A clearly defined user, evidence that the problem is real, and a noticeable benefit to learning or teaching. |
| Innovation and creativity | 20 | A fresh idea or a useful twist on a known one, and a justified use of AI. |
| Technical implementation | 25 | A working main flow, sensible data and methods, and evidence that it works. |
| Usability and responsible use | 15 | Ease of use for the target user, clear explanations, careful handling of data, and accessibility. |
| Presentation and clarity | 15 | A clear demo video, a coherent story across slides and answers, and a README that lets others run the project. |

## Contact

- Anika U Bhat: 9113516891
- Varun Aditya: 9880904610
