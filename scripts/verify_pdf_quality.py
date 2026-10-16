#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
验证生成的 PDF 质量与文本合规性
"""
import os
import fitz

def verify():
    pdf_path = os.path.join("artifacts", "competition-materials", "pdf", "雅思口语喵-项目说明书.pdf")
    if not os.path.exists(pdf_path):
        print(f"Error: {pdf_path} does not exist.")
        return False
    
    doc = fitz.open(pdf_path)
    total_pages = len(doc)
    print(f"=== 验证报告：雅思口语喵-项目说明书.pdf ===")
    print(f"总页数: {total_pages} (预期: 9)")
    assert total_pages == 9, f"总页数必须为 9，实际为 {total_pages}"
    
    # 待查占位符（排除代码中的保留字如 undefined）
    placeholders = ["TODO", "FIXME", "张三", "李四", "XX大学", "某大学", "待补充姓名", "[待填写]", "Lorem ipsum"]
    
    total_chars = 0
    all_pages_clean = True
    
    for i, page in enumerate(doc):
        page_num = i + 1
        text = page.get_text()
        clean_text = text.replace(" ", "").replace("\n", "")
        chars = len(clean_text)
        total_chars += chars
        
        print(f"\n[第 {page_num} 页] 字符数: {chars}")
        first_line = clean_text[:35]
        print(f"  前缀: {first_line}...")
        
        # Check placeholders
        for p in placeholders:
            if p in text:
                print(f"  ⚠️ 发现占位符: {p}")
                all_pages_clean = False
                
        # Check footer
        footer_expected = f"第 {page_num} 页"
        if footer_expected not in text:
            print(f"  ⚠️ 页脚缺少页码: '{footer_expected}'")
            all_pages_clean = False
            
    print(f"\n全书总字符数(不含空格与换行): {total_chars}")
    doc.close()
    
    if all_pages_clean:
        print("\n✅ 所有页面文本、页码与占位符检查完全通过！")
    return all_pages_clean

if __name__ == "__main__":
    verify()
