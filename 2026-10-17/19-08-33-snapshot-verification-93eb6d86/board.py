from collections import deque

values = deque(map(int, input().split()))
print(sum(values))
