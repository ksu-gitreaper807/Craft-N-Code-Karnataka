import re
from collections import Counter

text = "the quick brown fox jumps over the lazy dog the fox"
words = re.findall(r"[a-z']+", text.lower())
for word, count in Counter(words).most_common(3):
    print(f"{word:<10}{count}")