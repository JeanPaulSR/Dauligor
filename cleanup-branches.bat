@echo off
cd /d E:\DnD\Professional\Dev\Dauligor

echo === Removing worktrees ===
git worktree remove --force .claude/worktrees/kind-maxwell-bfa076
git worktree remove --force .claude/worktrees/stupefied-matsumoto-817b1d
git worktree remove --force .claude/worktrees/upbeat-tu-b931ef

echo === Removing orphaned worktree dirs ===
if exist ".claude\worktrees\funny-sutherland-e1e5fa" rmdir /S /Q ".claude\worktrees\funny-sutherland-e1e5fa"
if exist ".claude\worktrees\lucid-kepler-310a16" rmdir /S /Q ".claude\worktrees\lucid-kepler-310a16"

echo === Deleting branches ===
git branch -D claude/kind-maxwell-bfa076
git branch -D claude/stupefied-matsumoto-817b1d
git branch -D claude/upbeat-tu-b931ef

echo === Pruning stale worktree metadata ===
git worktree prune -v

echo.
echo === Final state ===
git branch -a
echo.
git worktree list

echo.
echo Done. Press any key to close.
pause >nul
