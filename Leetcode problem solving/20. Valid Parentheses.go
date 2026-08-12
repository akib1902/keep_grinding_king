// there is few ways to solve this. make closed check."([)]" is false.
//open bracket is "(", "[", "{" &  closed bracket is ")", "]", "}". then on first bracket check brkt. check close brkt match if not check nxt opening brkt else false. recursion continues.
//Given a string s containing just the characters '(', ')', '{', '}', '[' and ']', determine if the input string is valid. give true or false
func isValid(s string) bool {
	stack := []rune{}
	bracketMap := map[rune]rune{
		')': '(',
		']': '[',
		'}': '{',
	}
	for _, char := range s {
		if char == '(' || char == '[' || char == '{' {
			stack = append(stack, char)
		} else {
			if len(stack) == 0 || stack[len(stack)-1] != bracketMap[char] {
				return false
			}
			stack = stack[:len(stack)-1]
		}
	}
	return len(stack) == 0
}
