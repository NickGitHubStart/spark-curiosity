# Contributing

Thanks for your interest in Spark Curiosity!

## Development setup

```powershell
git clone https://github.com/NickGitHubStart/spark-curiosity.git
cd spark-curiosity
npm install
cp .env.example .env   # add your keys locally — never commit .env
npm run build:desktop-stack
npm run runtime:start:win
```

## Before opening a PR

1. Run tests: `npm run test:companion`
2. Keep changes focused — match existing style in the touched package
3. Do not commit secrets, user memory, or Firebase signing files (see `.gitignore`)

## Windows native changes

After editing `apps/desktop-native/`, rebuild via `npm run build:installer:win` or `scripts/build-dist.ps1` so `dist-package/native/ActiveWindowWatcher.exe` is updated.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
