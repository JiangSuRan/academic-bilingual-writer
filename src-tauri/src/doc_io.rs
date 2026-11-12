// 文稿与配置的本地 IO:原子写入 + 滚动备份
// 原子策略:先写同目录临时文件,fsync 后 rename 替换;备份在覆盖前生成

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// 原子写入 UTF-8 文本;可选 BOM(便于旧版记事本/Word 识别编码)
pub fn write_text_atomic(path: &Path, content: &str, with_bom: bool) -> Result<(), String> {
    let dir = path
        .parent()
        .ok_or_else(|| "目标路径缺少父目录".to_string())?;
    fs::create_dir_all(dir).map_err(|e| format!("创建目录失败:{}", e))?;

    let tmp = dir.join(format!(
        ".{}.tmp-{}",
        path.file_name().unwrap_or_default().to_string_lossy(),
        std::process::id()
    ));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("创建临时文件失败:{}", e))?;
        if with_bom {
            f.write_all(&[0xEF, 0xBB, 0xBF]).map_err(|e| e.to_string())?;
        }
        f.write_all(content.as_bytes()).map_err(|e| format!("写入失败:{}", e))?;
        f.sync_all().map_err(|e| format!("刷盘失败:{}", e))?;
    }
    // Windows 上 rename 到已存在文件会失败,先移除旧文件
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("移除旧文件失败:{}", e))?;
    }
    fs::rename(&tmp, path).map_err(|e| format!("替换文件失败:{}", e))?;
    Ok(())
}

/// 覆盖写入前把旧内容备份到 backup_dir,按 keep 上限裁剪
/// 返回备份文件路径(从未有旧文件时返回 None)
pub fn backup_before_overwrite(
    target: &Path,
    backup_dir: &Path,
    keep: usize,
) -> Result<Option<PathBuf>, String> {
    if !target.exists() {
        return Ok(None);
    }
    let stamp = timestamp_name();
    fs::create_dir_all(backup_dir).map_err(|e| format!("创建备份目录失败:{}", e))?;
    let dest = backup_dir.join(format!("{}.json", stamp));
    fs::copy(target, &dest).map_err(|e| format!("备份失败:{}", e))?;
    prune_backups(backup_dir, keep)?;
    Ok(Some(dest))
}

fn prune_backups(dir: &Path, keep: usize) -> Result<(), String> {
    let mut entries: Vec<PathBuf> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|x| x == "json").unwrap_or(false))
        .collect();
    // 文件名是时间戳,字典序即时间序
    entries.sort();
    if entries.len() > keep {
        for p in &entries[..entries.len() - keep] {
            let _ = fs::remove_file(p);
        }
    }
    Ok(())
}

fn timestamp_name() -> String {
    // 无 chrono 依赖:毫秒级系统时间构造可排序名称
    let ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{:020}", ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_roundtrip() {
        let dir = std::env::temp_dir().join(format!("abw-test-{}", std::process::id()));
        let p = dir.join("doc.json");
        write_text_atomic(&p, "{\"a\":1}", false).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "{\"a\":1}");
        // 覆盖写再次成功
        write_text_atomic(&p, "{\"a\":2}", true).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), "\u{feff}{\"a\":2}");
    }

    #[test]
    fn backup_and_prune() {
        let dir = std::env::temp_dir().join(format!("abw-bk-{}", std::process::id()));
        let target = dir.join("target.json");
        let bks = dir.join("backups");
        fs::create_dir_all(&dir).unwrap();
        fs::write(&target, "v1").unwrap();
        assert!(backup_before_overwrite(&target, &bks, 2).unwrap().is_some());
        fs::write(&target, "v2").unwrap();
        backup_before_overwrite(&target, &bks, 2).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1100));
        fs::write(&target, "v3").unwrap();
        backup_before_overwrite(&target, &bks, 2).unwrap();
        let n = fs::read_dir(&bks).unwrap().count();
        assert!(n <= 2, "备份应裁剪到上限,实际 {} 个", n);
    }
}
