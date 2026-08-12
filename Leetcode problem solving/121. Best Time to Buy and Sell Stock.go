//prices[i] day
// it will go and find the chipest one day sell next maximum prices[i]<prices[j] when j>i
// will check if a prices[i] is greater than prices[j] for all prices[i] else false
//an array of integers where j>i. now make this into go code "if a arr[i] is greater than arr[j], do this for all arr[i]. outputs arr[j]-arr[i] else 0.
// func main() {
//     arr := []int{5, 2, 8, 1}
//     n := len(arr)

//     // result matrix to store outputs for each pair (i, j)
//     result := make([][]int, n)
//     for i := range result {
//         result[i] = make([]int, n)
//     }

//     for i := 0; i < n; i++ {
//         for j := i + 1; j < n; j++ {
//             if arr[i] > arr[j] {
//                 result[i][j] = arr[j] - arr[i]
//             } else {
//                 result[i][j] = 0
//             }
//         }
//     }

//     fmt.Println("Input:", arr)
//     fmt.Println("Result matrix:")
//     for _, row := range result {
//         fmt.Println(row)
//     }
// }
func maxProfit(prices []int) int {
    if len(prices) == 0 {
        return 0
    }

    minPrice := prices[0]
    maxProfit := 0

    for i := 1; i < len(prices); i++ {
        if prices[i] < minPrice {
            minPrice = prices[i]
        } else {
            profit := prices[i] - minPrice
            if profit > maxProfit {
                maxProfit = profit
            }
        }
    }

    return maxProfit
}