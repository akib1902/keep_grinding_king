//a go program array nums checks if any value shows more than one time.
//outputs true if same value more than once else false.
func containsDuplicate(nums []int) bool {
    seen := make(map[int]bool)
    for _, num := range nums {
        if seen[num] {
            return true
        }
        seen[num] = true
    }
    return false
}